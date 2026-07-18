"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  QwenRealtimeClient,
  type QwenRealtimeStatus,
} from "@/lib/qwen/realtimeClient";
import {
  getFileExtension,
  inferAudioMimeType,
  isSupportedAudioFile,
} from "@/lib/audio/formats";

import AudioUploader from "@/components/AudioUploader";
import ListeningHistory from "@/components/ListeningHistory";
import MusicPlayer from "@/components/MusicPlayer";
import UserReplyBox from "@/components/UserReplyBox";

import { useLocalAudioFeatures } from "@/hooks/useLocalAudioFeatures";

import type {
  CommentFeedback,
  LocalAudioFeatures,
  ListeningMessage,
  PlaybackSnapshot,
} from "@/types/music";

const INITIAL_PLAYBACK: PlaybackSnapshot = {
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  isSeeking: false,
};

type CompanionReplyStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "error";

type QwenMomentStatus =
  | "idle"
  | "connected"
  | "commenting"
  | "error";

type QwenPromptKind = "user_reply" | "proactive_comment";

type PendingQwenPrompt = {
  prompt: string;
  musicTimeSeconds: number;
  kind: QwenPromptKind;
};

const USER_REPLY_DELAY_MS = 2000;
const QWEN_COMMENT_COOLDOWN_MS = 5000;
const MIN_PROACTIVE_COMMENT_SECOND = 4;
const SOUND_START_GRACE_SECONDS = 2;
const AUDIBLE_RMS_THRESHOLD = 0.018;

function canUseServerAudioTranscode() {
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function createMessageId(): string {
  if (
    typeof crypto !== "undefined" &&
    "randomUUID" in crypto
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function getRealtimeStatusText(
  status: QwenRealtimeStatus | "not_started",
): string {
  const statusText: Record<
    QwenRealtimeStatus | "not_started",
    string
  > = {
    not_started: "千问 Realtime 未连接",
    idle: "千问 Realtime 空闲",
    connecting: "千问 Realtime 连接中",
    connected: "千问 Realtime 已连接",
    configured: "千问 Realtime 已准备好",
    streaming: "千问 Realtime 正在响应",
    closed: "千问 Realtime 已断开",
    error: "千问 Realtime 出错",
  };

  return statusText[status] ?? status;
}

function getQwenMomentStatusText(status: QwenMomentStatus) {
  if (status === "connected") {
    return "Realtime 已连接。用户消息和主动短评会交给千问生成。";
  }

  if (status === "commenting") {
    return "正在请求千问生成主动陪听短评。";
  }

  if (status === "error") {
    return "Realtime 连接不稳定，暂时无法请求千问。";
  }

  return "播放时会自动请求千问生成主动陪听短评。";
}

function normalizeText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？!?、,.]/g, "");
}

function isDuplicateCompanionReply(
  nextText: string,
  previousMessages: ListeningMessage[],
) {
  const cleanNextText = normalizeText(nextText);

  if (!cleanNextText) {
    return true;
  }

  return previousMessages.some((message) => {
    if (message.sender !== "companion") {
      return false;
    }

    const cleanPreviousText = normalizeText(message.text);

    if (!cleanPreviousText) {
      return false;
    }

    return (
      cleanPreviousText === cleanNextText ||
      cleanPreviousText.includes(cleanNextText) ||
      cleanNextText.includes(cleanPreviousText)
    );
  });
}

function formatPlaybackTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const restSeconds = safeSeconds % 60;

  return `${minutes}:${restSeconds.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function createTranscodedFileName(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  const baseName =
    dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;

  return `${baseName}-converted.wav`;
}

function formatLocalAudioFeatures(
  features: LocalAudioFeatures | null,
  currentTimeSeconds: number,
) {
  if (!features) {
    return "本地音频特征还在分析中或暂不可用。";
  }

  const currentMoment =
    getCurrentVolumeMomentText(
      features,
      currentTimeSeconds,
    );
  const nearbyMoment =
    getNearbyVolumeMomentText(
      features,
      currentTimeSeconds,
    );
  const soundStartSecond =
    getEstimatedSoundStartSecond(features);

  return [
    `浏览器本地分析时长：${
      features.durationSeconds
        ? formatPlaybackTime(features.durationSeconds)
        : "未知"
    }`,
    `采样率：${
      features.sampleRate ? `${features.sampleRate} Hz` : "未知"
    }`,
    `整体听感：${features.energyLabel}`,
    `声音感觉：${features.brightnessLabel}`,
    `变化感觉：${features.motionLabel}`,
    `当前这一秒：${currentMoment}`,
    `当前附近几秒：${nearbyMoment}`,
    `估计声音开始：${
      soundStartSecond === null
        ? "未知"
        : formatPlaybackTime(soundStartSecond)
    }`,
    `说话参考：${features.styleHint}`,
    `分析说明：${features.analysisNote}`,
  ].join("\n");
}

function getEstimatedSoundStartSecond(
  features: LocalAudioFeatures | null,
) {
  if (!features?.volumeMoments.length) {
    return null;
  }

  const moment = features.volumeMoments.find(
    (item) => item.rms >= AUDIBLE_RMS_THRESHOLD,
  );

  return moment?.timeSeconds ?? null;
}

function isAudibleAroundCurrentTime(
  features: LocalAudioFeatures | null,
  currentTimeSeconds: number,
) {
  if (!features?.volumeMoments.length) {
    return true;
  }

  const currentSecond = Math.floor(currentTimeSeconds);
  const nearbyMoments = features.volumeMoments.filter(
    (moment) =>
      Math.abs(moment.timeSeconds - currentSecond) <= 1,
  );

  if (!nearbyMoments.length) {
    return true;
  }

  return nearbyMoments.some(
    (moment) => moment.rms >= AUDIBLE_RMS_THRESHOLD,
  );
}

function getCurrentVolumeMomentText(
  features: LocalAudioFeatures,
  currentTimeSeconds: number,
) {
  const moments = features.volumeMoments;

  if (!moments.length) {
    return "暂时没有当前音量变化线索。";
  }

  const currentIndex = moments.findIndex(
    (moment) =>
      moment.timeSeconds >=
      Math.floor(currentTimeSeconds),
  );
  const safeIndex =
    currentIndex >= 0 ? currentIndex : moments.length - 1;
  const current = moments[safeIndex];
  const previous =
    safeIndex > 0 ? moments[safeIndex - 1] : null;

  if (!previous) {
    return "刚开始听，先给一句自然反应就好。";
  }

  const difference = current.rms - previous.rms;
  const ratio =
    previous.rms > 0.001
      ? current.rms / previous.rms
      : current.rms > 0.02
        ? 3
        : 1;

  if (difference > 0.035 || ratio > 1.8) {
    return "声音比前一秒明显大了。";
  }

  if (difference < -0.035 || ratio < 0.55) {
    return "声音比前一秒明显轻了。";
  }

  if (current.rms > 0.12) {
    return "这一秒声音比较满。";
  }

  if (current.rms < 0.025) {
    return "这一秒声音比较轻。";
  }

  return "这一秒比较平稳。";
}

function getNearbyVolumeMomentText(
  features: LocalAudioFeatures,
  currentTimeSeconds: number,
) {
  const moments = features.volumeMoments;

  if (!moments.length) {
    return "暂时没有当前片段线索。";
  }

  const currentSecond = Math.floor(currentTimeSeconds);
  const nearbyMoments = moments.filter(
    (moment) =>
      moment.timeSeconds >= currentSecond - 2 &&
      moment.timeSeconds <= currentSecond + 2,
  );

  if (!nearbyMoments.length) {
    return "当前附近没有可用的音量线索。";
  }

  const first = nearbyMoments[0];
  const last = nearbyMoments[nearbyMoments.length - 1];
  const maxMoment = nearbyMoments.reduce((max, item) =>
    item.rms > max.rms ? item : max,
  );
  const minMoment = nearbyMoments.reduce((min, item) =>
    item.rms < min.rms ? item : min,
  );
  const rise = last.rms - first.rms;
  const spread = maxMoment.rms - minMoment.rms;

  if (maxMoment.rms < AUDIBLE_RMS_THRESHOLD) {
    return "这一小段还比较空，暂时缺少明显音乐细节。";
  }

  if (rise > 0.035) {
    return "这一小段声音在往上起来。";
  }

  if (rise < -0.035) {
    return "这一小段声音在慢慢收。";
  }

  if (spread > 0.05) {
    return "这一小段起伏比较明显。";
  }

  return "这一小段比较稳定。";
}

function getEarliestProactiveCommentSecond(
  features: LocalAudioFeatures | null,
) {
  const soundStartSecond =
    getEstimatedSoundStartSecond(features);

  if (soundStartSecond === null) {
    return 8;
  }

  return Math.max(
    MIN_PROACTIVE_COMMENT_SECOND,
    soundStartSecond + SOUND_START_GRACE_SECONDS,
  );
}

function getHumanReplyGuide(
  kind: QwenPromptKind,
) {
  const baseGuide = [
    "回复风格：像真人正在一起听，不像乐评、不像作文、不像客服。",
    "可以真情流露，但不要套固定句式或复用本地提示措辞。",
    "每句都要落到具体声音对象、具体变化动作或具体风格依据上；不能只说变活了、清爽、舒服、有感觉。",
    "评论结构优先是：听到的对象/位置 + 它发生了什么 + 你的即时反应。缺任一部分时，宁可短也不要空泛。",
    "表达参考：可以像“哇，这个咚的一声低音感觉让人心里一颤”“诶，这一句有点意思，很国风的感觉”“后面背景里那个像拨弦的声音好好听，有点像琵琶”这样，把声音、变化和感受说清楚。",
    "如果判断风格，要说出风格名称和依据；如果判断乐器感，只能用不确定表达，并说明依据来自当前听感。",
    "如果没有足够线索，就只基于声音大小、进入、停顿、重复听感这类确定能支持的内容回应。",
  ];

  if (kind === "user_reply") {
    return [
      ...baseGuide,
      "用户在聊天时，先自然接住用户的话，再顺着音乐补一句感受。",
    ].join("\n");
  }

  return [
    ...baseGuide,
    "主动短评时，不要像定时播报；像听到这一刻忍不住冒出一句话。当前附近没明显声音时不要急着评价。",
  ].join("\n");
}

function buildQwenPrompt({
  kind,
  audioFile,
  playback,
  messages,
  localAudioFeatures,
  userText,
  isRevisitedSegment = false,
}: {
  kind: QwenPromptKind;
  audioFile: File;
  playback: PlaybackSnapshot;
  messages: ListeningMessage[];
  localAudioFeatures: LocalAudioFeatures | null;
  userText?: string;
  isRevisitedSegment?: boolean;
}) {
  const currentTime = formatPlaybackTime(playback.currentTime);
  const duration = playback.duration
    ? formatPlaybackTime(playback.duration)
    : "未知";
  const recentMessages = messages.slice(-10);
  const history =
    recentMessages.length > 0
      ? recentMessages
          .map((message) => {
            const speaker =
              message.sender === "user" ? "用户" : "你";
            const messageTime = formatPlaybackTime(
              message.musicTimeSeconds,
            );

            return `${speaker}@${messageTime}：${message.text}`;
          })
          .join("\n")
      : "暂无。";
  const task =
    kind === "user_reply"
      ? `用户刚刚说：${userText ?? ""}\n请像朋友一样自然回应。`
      : "现在到达新的播放时间点，请主动给一句真实的陪听短评。";
  const playbackContext = isRevisitedSegment
    ? "用户把进度拉回了之前听过的一段；可以意识到这是回听/重复听，但不要机械地说“你又回来了”，要像朋友自然发现这段还是值得再听。"
    : "这是当前正常播放到的新位置。";

  return [
    "你正在和用户一起听歌，请用中文回复。",
    "回复要求：只输出一句话，尽量不超过36个中文字符；像普通用户随口说的；不要输出列表；不要说你无法听音频。",
    "具体度要求：不要只给形容词，必须说明“哪里/什么声音/哪种变化”让你产生这个感受。",
    "可以学习表达参考的具体程度，但不要机械照抄；你需要根据当前上下文自己组织一句新的自然评论。",
    getHumanReplyGuide(kind),
    `歌曲文件名：${audioFile.name}`,
    `文件格式：${inferAudioMimeType(audioFile) || getFileExtension(audioFile.name) || "未知"}`,
    `文件大小：${formatFileSize(audioFile.size)}`,
    `当前播放：${currentTime} / ${duration}`,
    `播放状态：${playback.isPlaying ? "正在播放" : "暂停"}`,
    `播放上下文：${playbackContext}`,
    "本地音频特征：",
    formatLocalAudioFeatures(
      localAudioFeatures,
      playback.currentTime,
    ),
    "最近 messages：",
    history,
    "当前任务：",
    task,
  ].join("\n");
}

export default function Home() {
  const [audioFile, setAudioFile] = useState<File | null>(
    null,
  );

  const [playback, setPlayback] =
    useState<PlaybackSnapshot>(INITIAL_PLAYBACK);

  const [listeningMessages, setListeningMessages] =
    useState<ListeningMessage[]>([]);

  const [feedbackByCommentId, setFeedbackByCommentId] =
    useState<Record<string, CommentFeedback>>({});

  const [companionReplyStatus, setCompanionReplyStatus] =
    useState<CompanionReplyStatus>("idle");

  const [companionReplyError, setCompanionReplyError] =
    useState("");

  const [qwenRealtimeStatus, setQwenRealtimeStatus] =
    useState<QwenRealtimeStatus | "not_started">(
      "not_started",
    );

  const [qwenRealtimeError, setQwenRealtimeError] =
    useState("");

  const [audioFileError, setAudioFileError] =
    useState("");

  const [isPreparingAudio, setIsPreparingAudio] =
    useState(false);

  const [qwenMomentStatus, setQwenMomentStatus] =
    useState<QwenMomentStatus>("idle");

  const qwenClientRef = useRef<QwenRealtimeClient | null>(
    null,
  );

  const qwenReadyRef = useRef(false);

  const lastRealtimeCommentSecondRef = useRef(0);

  const previousPlaybackSecondRef = useRef(0);

  const furthestPlaybackSecondRef = useRef(0);

  const revisitedUntilSecondRef = useRef(0);

  const lastQwenReconnectMsRef = useRef(0);

  const pendingQwenPromptRef =
    useRef<PendingQwenPrompt | null>(null);

  const scheduledQwenPromptTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduledQwenPromptKindRef =
    useRef<QwenPromptKind | null>(null);

  const lastQwenPromptSentMsRef = useRef(0);

  const waitingForQwenResponseRef = useRef(false);

  const qwenResponseMusicTimeRef =
    useRef<number | null>(null);

  const qwenRequestIdRef = useRef(0);

  const playbackRef =
    useRef<PlaybackSnapshot>(INITIAL_PLAYBACK);

  const listeningMessagesRef = useRef<ListeningMessage[]>([]);

  const {
    status: localFeatureStatus,
    features: localAudioFeatures,
    analyzeFile: analyzeLocalAudioFeatures,
    reset: resetLocalAudioFeatures,
  } = useLocalAudioFeatures();

  const trackKey = useMemo(() => {
    if (!audioFile) {
      return "no-track";
    }

    return [
      audioFile.name,
      audioFile.size,
      audioFile.lastModified,
    ].join("-");
  }, [audioFile]);

  const hasAudio = Boolean(audioFile);

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    listeningMessagesRef.current = listeningMessages;
  }, [listeningMessages]);

  useEffect(() => {
    return () => {
      if (scheduledQwenPromptTimeoutRef.current) {
        clearTimeout(scheduledQwenPromptTimeoutRef.current);
        scheduledQwenPromptTimeoutRef.current = null;
      }

      qwenClientRef.current?.disconnect();
      qwenClientRef.current = null;
      qwenReadyRef.current = false;
    };
  }, []);

  const addCompanionMessage = useCallback(
    (
      text: string,
      commentIdPrefix = "companion",
      musicTimeSeconds = playbackRef.current.currentTime,
    ) => {
      const cleanText = text.trim();

      if (!cleanText) {
        return;
      }

      setListeningMessages((previousMessages) => {
        if (
          isDuplicateCompanionReply(
            cleanText,
            previousMessages,
          )
        ) {
          return previousMessages;
        }

        return [
          ...previousMessages,
          {
            id: `${commentIdPrefix}-${Date.now()}`,
            sender: "companion",
            text:
              cleanText.length > 45
                ? cleanText.slice(0, 45)
                : cleanText,
            musicTimeSeconds,
            commentId: `${commentIdPrefix}-comment-${Date.now()}`,
          },
        ];
      });
    },
    [],
  );

  const connectQwenRealtime = useCallback(() => {
    if (qwenClientRef.current) {
      return qwenClientRef.current;
    }

    setQwenRealtimeError("");
    setQwenRealtimeStatus("connecting");
    qwenReadyRef.current = false;

    const client = new QwenRealtimeClient({
      onStatusChange: (status) => {
        setQwenRealtimeStatus(status);

        if (status === "configured") {
          qwenReadyRef.current = true;
          setQwenMomentStatus("connected");
          setQwenRealtimeError("");

          const pendingPrompt = pendingQwenPromptRef.current;

          if (
            pendingPrompt &&
            qwenClientRef.current?.sendTextMessage(
              pendingPrompt.prompt,
            )
          ) {
            qwenRequestIdRef.current += 1;
            waitingForQwenResponseRef.current = true;
            qwenResponseMusicTimeRef.current =
              pendingPrompt.musicTimeSeconds;
            lastQwenPromptSentMsRef.current = Date.now();
            console.info(
              "[MusicCompanion] Qwen prompt sent after realtime configured",
              {
                requestId: qwenRequestIdRef.current,
                kind: pendingPrompt.kind,
                musicTimeSeconds:
                  pendingPrompt.musicTimeSeconds,
                promptPreview: pendingPrompt.prompt.slice(0, 120),
              },
            );

            pendingQwenPromptRef.current = null;
            setCompanionReplyStatus("streaming");
            setQwenMomentStatus("commenting");
          }
        }

        if (
          status === "closed" ||
          status === "error"
        ) {
          qwenReadyRef.current = false;
          qwenClientRef.current = null;
          pendingQwenPromptRef.current = null;
          waitingForQwenResponseRef.current = false;
          qwenResponseMusicTimeRef.current = null;
          setQwenMomentStatus("error");
        }
      },

      onTextDelta: () => {},

      onTextDone: (text) => {
        if (!waitingForQwenResponseRef.current) {
          console.warn(
            "[MusicCompanion] Ignored Qwen text.done without an active outbound prompt",
            text,
          );
          return;
        }

        waitingForQwenResponseRef.current = false;
        addCompanionMessage(
          text,
          "qwen-realtime",
          qwenResponseMusicTimeRef.current ??
            playbackRef.current.currentTime,
        );
        qwenResponseMusicTimeRef.current = null;
        setCompanionReplyStatus("idle");
        setQwenMomentStatus("connected");
      },

      onError: (message) => {
        setQwenRealtimeError(message);
        setCompanionReplyStatus("error");
        setCompanionReplyError(message);
        qwenReadyRef.current = false;
        qwenClientRef.current = null;
        pendingQwenPromptRef.current = null;
        waitingForQwenResponseRef.current = false;
        qwenResponseMusicTimeRef.current = null;
        setQwenMomentStatus("error");
      },

      onRawEvent: (event) => {
        console.debug("[Qwen Realtime Event]", event);
      },
    });

    qwenClientRef.current = client;
    client.connect();

    return client;
  }, [addCompanionMessage]);

  const disconnectQwenRealtime = useCallback(() => {
    qwenClientRef.current?.disconnect();
    qwenClientRef.current = null;
    qwenReadyRef.current = false;
    pendingQwenPromptRef.current = null;
    waitingForQwenResponseRef.current = false;
    qwenResponseMusicTimeRef.current = null;
    setQwenMomentStatus("idle");
    setQwenRealtimeStatus("closed");
  }, []);

  const sendPromptToQwen = useCallback(
    ({
      prompt,
      musicTimeSeconds,
      kind,
    }: PendingQwenPrompt) => {
      const client = connectQwenRealtime();

      setCompanionReplyStatus("thinking");
      setCompanionReplyError("");
      setQwenRealtimeError("");

      if (client.isReady() && client.sendTextMessage(prompt)) {
        qwenRequestIdRef.current += 1;
        waitingForQwenResponseRef.current = true;
        qwenResponseMusicTimeRef.current = musicTimeSeconds;
        lastQwenPromptSentMsRef.current = Date.now();
        console.info("[MusicCompanion] Qwen prompt sent", {
          requestId: qwenRequestIdRef.current,
          kind,
          musicTimeSeconds,
          promptPreview: prompt.slice(0, 120),
        });

        setCompanionReplyStatus("streaming");
        setQwenMomentStatus("commenting");
        return true;
      }

      pendingQwenPromptRef.current = {
        prompt,
        musicTimeSeconds,
        kind,
      };
      setQwenMomentStatus("commenting");
      return false;
    },
    [connectQwenRealtime],
  );

  const schedulePromptToQwen = useCallback(
    ({
      prompt,
      kind,
      musicTimeSeconds,
      minimumDelayMs = 0,
      replaceScheduled = true,
    }: {
      prompt: string;
      kind: QwenPromptKind;
      musicTimeSeconds: number;
      minimumDelayMs?: number;
      replaceScheduled?: boolean;
    }) => {
      if (
        scheduledQwenPromptTimeoutRef.current &&
        !replaceScheduled
      ) {
        return false;
      }

      if (scheduledQwenPromptTimeoutRef.current) {
        clearTimeout(scheduledQwenPromptTimeoutRef.current);
        scheduledQwenPromptTimeoutRef.current = null;
        scheduledQwenPromptKindRef.current = null;
      }

      const now = Date.now();
      const cooldownDelayMs = Math.max(
        0,
        QWEN_COMMENT_COOLDOWN_MS -
          (now - lastQwenPromptSentMsRef.current),
      );
      const delayMs = Math.max(
        minimumDelayMs,
        cooldownDelayMs,
      );

      setCompanionReplyStatus("thinking");
      setCompanionReplyError("");
      setQwenRealtimeError("");
      setQwenMomentStatus("commenting");

      scheduledQwenPromptTimeoutRef.current = setTimeout(() => {
        scheduledQwenPromptTimeoutRef.current = null;
        scheduledQwenPromptKindRef.current = null;
        sendPromptToQwen({
          prompt,
          musicTimeSeconds,
          kind,
        });
      }, delayMs);
      scheduledQwenPromptKindRef.current = kind;

      return true;
    },
    [sendPromptToQwen],
  );

  const cancelScheduledProactiveComment =
    useCallback(() => {
      if (
        scheduledQwenPromptTimeoutRef.current &&
        scheduledQwenPromptKindRef.current ===
          "proactive_comment"
      ) {
        clearTimeout(scheduledQwenPromptTimeoutRef.current);
        scheduledQwenPromptTimeoutRef.current = null;
        scheduledQwenPromptKindRef.current = null;
        setQwenMomentStatus("connected");
      }
    }, []);

  const resetListeningSession = useCallback(() => {
    if (scheduledQwenPromptTimeoutRef.current) {
      clearTimeout(scheduledQwenPromptTimeoutRef.current);
      scheduledQwenPromptTimeoutRef.current = null;
      scheduledQwenPromptKindRef.current = null;
    }

    setPlayback(INITIAL_PLAYBACK);
    setListeningMessages([]);
    setFeedbackByCommentId({});
    setCompanionReplyStatus("idle");
    setCompanionReplyError("");
    setQwenRealtimeError("");
    setAudioFileError("");
    setQwenMomentStatus("idle");
    resetLocalAudioFeatures();

    lastRealtimeCommentSecondRef.current = 0;
    previousPlaybackSecondRef.current = 0;
    furthestPlaybackSecondRef.current = 0;
    revisitedUntilSecondRef.current = 0;
    lastQwenPromptSentMsRef.current = 0;
    waitingForQwenResponseRef.current = false;
    qwenResponseMusicTimeRef.current = null;
  }, [resetLocalAudioFeatures]);

  const transcodeAudioFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/audio/transcode", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let message = "音频转码失败。";

      try {
        const body =
          (await response.json()) as {
            error?: string;
          };

        message = body.error || message;
      } catch {}

      throw new Error(message);
    }

    const blob = await response.blob();

    return new File(
      [blob],
      createTranscodedFileName(file.name),
      {
        type: "audio/wav",
        lastModified: Date.now(),
      },
    );
  };

  const handleFileSelect = async (file: File) => {
    if (!isSupportedAudioFile(file)) {
      setAudioFileError(
        "暂不支持这个音频格式，请选择 mp3、m4a、aac、wav、flac、ogg 或 webm。",
      );
      return;
    }

    resetListeningSession();

    const shouldTranscode =
      getFileExtension(file.name) === ".m4a" &&
      canUseServerAudioTranscode();

    setIsPreparingAudio(shouldTranscode);

    let playableFile = file;

    try {
      if (shouldTranscode) {
        setAudioFileError(
          "正在把这个 m4a 转成浏览器更稳定支持的 WAV 音频…",
        );
        playableFile = await transcodeAudioFile(file);
      }

      setAudioFile(playableFile);
      setAudioFileError("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "音频转码失败。";

      setAudioFile(null);
      setAudioFileError(
        `这个 m4a 当前无法转成可播放音频：${message}`,
      );
      return;
    } finally {
      setIsPreparingAudio(false);
    }

    void analyzeLocalAudioFeatures(playableFile).catch((error) => {
      console.warn("本地听感分析失败：", error);
    });
  };

  useEffect(() => {
    if (!audioFile) {
      return;
    }

    if (!playback.isPlaying || playback.isSeeking) {
      return;
    }

    if (
      qwenReadyRef.current ||
      qwenRealtimeStatus === "connecting"
    ) {
      return;
    }

    const now = Date.now();

    if (now - lastQwenReconnectMsRef.current < 10000) {
      return;
    }

    lastQwenReconnectMsRef.current = now;
    connectQwenRealtime();
  }, [
    audioFile,
    connectQwenRealtime,
    playback.isPlaying,
    playback.isSeeking,
    qwenRealtimeStatus,
  ]);

  useEffect(() => {
    if (!audioFile) {
      return;
    }

    const currentSecond = Math.floor(playback.currentTime);
    const previousSecond =
      previousPlaybackSecondRef.current;
    const furthestSecond =
      furthestPlaybackSecondRef.current;
    const didRewind =
      previousSecond - currentSecond >= 3;

    if (didRewind) {
      cancelScheduledProactiveComment();
      revisitedUntilSecondRef.current = Math.max(
        revisitedUntilSecondRef.current,
        furthestSecond,
        previousSecond,
      );
      lastRealtimeCommentSecondRef.current = Math.max(
        0,
        currentSecond - 18,
      );
    }

    if (currentSecond > furthestSecond) {
      furthestPlaybackSecondRef.current = currentSecond;
    }

    previousPlaybackSecondRef.current = currentSecond;

    if (!playback.isPlaying || playback.isSeeking) {
      return;
    }

    const earliestCommentSecond =
      getEarliestProactiveCommentSecond(
        localAudioFeatures,
      );

    if (currentSecond < earliestCommentSecond) {
      cancelScheduledProactiveComment();
      return;
    }

    if (
      !isAudibleAroundCurrentTime(
        localAudioFeatures,
        currentSecond,
      )
    ) {
      cancelScheduledProactiveComment();
      return;
    }

    const isRevisitedSegment =
      revisitedUntilSecondRef.current > 0 &&
      currentSecond <= revisitedUntilSecondRef.current;

    if (
      currentSecond - lastRealtimeCommentSecondRef.current <
      18
    ) {
      return;
    }

    lastRealtimeCommentSecondRef.current = currentSecond;
    schedulePromptToQwen({
      prompt: buildQwenPrompt({
        kind: "proactive_comment",
        audioFile,
        playback,
        messages: listeningMessagesRef.current,
        localAudioFeatures,
        isRevisitedSegment,
      }),
      kind: "proactive_comment",
      musicTimeSeconds: playback.currentTime,
      replaceScheduled: false,
    });
  }, [
    audioFile,
    playback,
    playback.currentTime,
    playback.isPlaying,
    playback.isSeeking,
    cancelScheduledProactiveComment,
    schedulePromptToQwen,
    localAudioFeatures,
  ]);

  const handleFeedbackChange = (
    commentId: string,
    feedback: CommentFeedback,
  ) => {
    setFeedbackByCommentId((previousFeedback) => ({
      ...previousFeedback,
      [commentId]: feedback,
    }));
  };

  const handleUserSend = async (text: string) => {
    if (!audioFile) {
      return;
    }

    const cleanText = text.trim();

    if (!cleanText) {
      return;
    }

    const newMessage: ListeningMessage = {
      id: createMessageId(),
      sender: "user",
      text: cleanText,
      musicTimeSeconds: playbackRef.current.currentTime,
    };

    const nextMessages = [
      ...listeningMessagesRef.current,
      newMessage,
    ];

    setListeningMessages(nextMessages);

    schedulePromptToQwen({
      prompt: buildQwenPrompt({
        kind: "user_reply",
        audioFile,
        playback: playbackRef.current,
        messages: nextMessages,
        localAudioFeatures,
        userText: cleanText,
        isRevisitedSegment:
          revisitedUntilSecondRef.current > 0 &&
          Math.floor(playbackRef.current.currentTime) <=
            revisitedUntilSecondRef.current,
      }),
      kind: "user_reply",
      musicTimeSeconds: playbackRef.current.currentTime,
      minimumDelayMs: USER_REPLY_DELAY_MS,
      replaceScheduled: true,
    });
  };

  return (
    <main className="app-shell">
      <div
        className="
          background-orb
          background-orb-blue
        "
        aria-hidden="true"
      />

      <div
        className="
          background-orb
          background-orb-purple
        "
        aria-hidden="true"
      />

      <section style={styles.container}>
        <header style={styles.header}>
          <div style={styles.brandBadge}>
            <span
              style={styles.brandDot}
              aria-hidden="true"
            />

            MusicCompanion
          </div>

          <h1 style={styles.title}>有人和你一起听</h1>

          <p style={styles.subtitle}>
            音乐发生的时候，也有人听见。
          </p>
        </header>

        <section style={styles.heroCard}>
          <p style={styles.description}>
            {!audioFile
              ? isPreparingAudio
                ? "正在准备这个音频文件，稍等一下。"
                : "选择一首音乐，AI会陪你聊它的听感、情绪和变化。"
              : localFeatureStatus === "analyzing"
                ? "正在理解这首歌的听感，不影响你直接播放。"
                : "音乐已准备好。你可以直接播放，千问会按播放时间主动短评。"}
          </p>

          <AudioUploader
            disabled={isPreparingAudio}
            onFileSelect={handleFileSelect}
          />

          {audioFileError && (
            <p style={styles.uploadError}>
              {audioFileError}
            </p>
          )}
        </section>

        <section style={styles.realtimeCard}>
          <div style={styles.realtimeHeader}>
            <div>
              <p style={styles.realtimeLabel}>
                Qwen-Omni-Realtime
              </p>

              <p style={styles.realtimeStatus}>
                {getRealtimeStatusText(qwenRealtimeStatus)}
              </p>
            </div>

            <div style={styles.realtimeButtons}>
              <button
                type="button"
                style={styles.realtimeButton}
                onClick={connectQwenRealtime}
                disabled={
                  qwenRealtimeStatus === "connecting" ||
                  qwenRealtimeStatus === "configured"
                }
              >
                连接千问
              </button>

              <button
                type="button"
                style={styles.realtimeButton}
                onClick={disconnectQwenRealtime}
              >
                断开
              </button>
            </div>
          </div>

          <p style={styles.realtimeHint}>
            {getQwenMomentStatusText(qwenMomentStatus)}
          </p>

          {qwenRealtimeError && (
            <p style={styles.realtimeError}>
              {qwenRealtimeError}
            </p>
          )}

          {hasAudio && (
            <button
              type="button"
              style={styles.manualRealtimeButton}
              onClick={() => {
                if (!audioFile) {
                  return;
                }

                schedulePromptToQwen({
                  prompt: buildQwenPrompt({
                    kind: "proactive_comment",
                    audioFile,
                    playback: playbackRef.current,
                    messages: listeningMessagesRef.current,
                    localAudioFeatures,
                  }),
                  kind: "proactive_comment",
                  musicTimeSeconds:
                    playbackRef.current.currentTime,
                  replaceScheduled: false,
                });
              }}
            >
              请求千问短评
            </button>
          )}
        </section>

        <MusicPlayer
          key={`player-${trackKey}`}
          audioFile={audioFile}
          onPlaybackStateChange={setPlayback}
        />

        <ListeningHistory
          messages={listeningMessages}
          feedbackByCommentId={feedbackByCommentId}
          onFeedbackChange={handleFeedbackChange}
        />

        {hasAudio && (
          <div
            style={styles.companionReplyStatus}
            aria-live="polite"
          >
            {companionReplyStatus === "thinking"
              ? "正在连接千问并发送 messages…"
              : companionReplyStatus === "streaming"
                ? "千问正在回复中…"
                : companionReplyStatus === "error"
                  ? companionReplyError
                  : "你发的话会连同最近 messages 一起发给千问 Realtime。"}
          </div>
        )}

        <UserReplyBox
          key={`reply-box-${trackKey}`}
          disabled={!audioFile}
          onSend={handleUserSend}
        />

        <footer style={styles.footer}>
          当前版本：用户消息和主动短评均通过千问 Realtime 文本事件生成。
        </footer>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: "640px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "24px",
  },

  header: {
    width: "100%",
    padding: "20px 10px 8px",
    textAlign: "center",
  },

  brandBadge: {
    width: "fit-content",
    margin: "0 auto 22px",
    padding: "7px 13px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    border: "1px solid rgba(113, 137, 180, 0.18)",
    borderRadius: "999px",
    background: "rgba(255, 255, 255, 0.68)",
    boxShadow: "0 8px 28px rgba(54, 89, 142, 0.08)",
    backdropFilter: "blur(16px)",
    color: "var(--text-secondary)",
    fontSize: "12px",
    fontWeight: 400,
    letterSpacing: "0.04em",
  },

  brandDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #5d8cff, #a47aff)",
    boxShadow: "0 0 14px rgba(93, 140, 255, 0.65)",
  },

  title: {
    margin: "0 0 12px",
    color: "var(--text-primary)",
    fontSize: "clamp(34px, 7vw, 52px)",
    fontWeight: 400,
    lineHeight: 1.12,
    letterSpacing: "-0.045em",
  },

  subtitle: {
    margin: 0,
    color: "var(--text-secondary)",
    fontSize: "15px",
    lineHeight: 1.7,
  },

  heroCard: {
    width: "100%",
    maxWidth: "520px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "18px",
    padding: "22px",
    border: "1px solid rgba(116, 139, 181, 0.16)",
    borderRadius: "24px",
    background: "rgba(255, 255, 255, 0.64)",
    boxShadow: "0 18px 60px rgba(74, 107, 163, 0.1)",
    backdropFilter: "blur(22px)",
  },

  description: {
    minHeight: "21px",
    margin: 0,
    color: "var(--text-secondary)",
    fontSize: "14px",
    lineHeight: 1.7,
    textAlign: "center",
  },

  uploadError: {
    maxWidth: "440px",
    margin: "-4px 0 0",
    color: "#c2410c",
    fontSize: "12px",
    lineHeight: 1.6,
    textAlign: "center",
  },

  realtimeCard: {
    width: "100%",
    maxWidth: "520px",
    padding: "16px",
    border: "1px solid rgba(116, 139, 181, 0.14)",
    borderRadius: "20px",
    background: "rgba(255, 255, 255, 0.56)",
    boxShadow: "0 14px 42px rgba(74, 107, 163, 0.08)",
    backdropFilter: "blur(18px)",
  },

  realtimeHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
  },

  realtimeLabel: {
    margin: "0 0 4px",
    color: "var(--text-tertiary)",
    fontSize: "11px",
    letterSpacing: "0.04em",
  },

  realtimeStatus: {
    margin: 0,
    color: "var(--text-secondary)",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  realtimeButtons: {
    display: "flex",
    gap: "8px",
    flexShrink: 0,
  },

  realtimeButton: {
    border: "1px solid rgba(116, 139, 181, 0.18)",
    borderRadius: "999px",
    padding: "7px 11px",
    background: "rgba(255, 255, 255, 0.7)",
    color: "var(--text-secondary)",
    fontSize: "12px",
    cursor: "pointer",
  },

  realtimeHint: {
    margin: "12px 0 0",
    color: "var(--text-tertiary)",
    fontSize: "11px",
    lineHeight: 1.7,
  },

  realtimeError: {
    margin: "10px 0 0",
    color: "#c2410c",
    fontSize: "12px",
    lineHeight: 1.6,
  },

  manualRealtimeButton: {
    marginTop: "12px",
    border: "1px solid rgba(93, 140, 255, 0.24)",
    borderRadius: "999px",
    padding: "8px 13px",
    background: "rgba(93, 140, 255, 0.1)",
    color: "var(--text-secondary)",
    fontSize: "12px",
    cursor: "pointer",
  },

  companionReplyStatus: {
    width: "100%",
    maxWidth: "520px",
    marginTop: "-8px",
    padding: "10px 14px",
    border: "1px solid rgba(116, 139, 181, 0.14)",
    borderRadius: "16px",
    background: "rgba(255, 255, 255, 0.54)",
    color: "var(--text-tertiary)",
    fontSize: "12px",
    lineHeight: 1.6,
    textAlign: "center",
    boxShadow: "0 10px 34px rgba(74, 107, 163, 0.06)",
    backdropFilter: "blur(18px)",
  },

  demoButton: {
    border: "1px solid rgba(116, 139, 181, 0.18)",
    borderRadius: "999px",
    padding: "8px 14px",
    background: "rgba(255, 255, 255, 0.56)",
    color: "var(--text-secondary)",
    fontSize: "12px",
    cursor: "pointer",
  },

  footer: {
    maxWidth: "520px",
    padding: "8px 12px 18px",
    color: "var(--text-tertiary)",
    fontSize: "11px",
    lineHeight: 1.7,
    textAlign: "center",
  },
};
