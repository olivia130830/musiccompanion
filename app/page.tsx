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

function formatNullableNumber(
  value: number | null,
  fractionDigits = 3,
) {
  if (typeof value !== "number") {
    return "未知";
  }

  return value.toFixed(fractionDigits);
}

function formatLocalAudioFeatures(
  features: LocalAudioFeatures | null,
) {
  if (!features) {
    return "本地音频特征还在分析中或暂不可用。";
  }

  return [
    `浏览器本地分析时长：${
      features.durationSeconds
        ? formatPlaybackTime(features.durationSeconds)
        : "未知"
    }`,
    `采样率：${
      features.sampleRate ? `${features.sampleRate} Hz` : "未知"
    }`,
    `声道数：${features.channels ?? "未知"}`,
    `能量：${features.energyLabel}`,
    `亮度：${features.brightnessLabel}`,
    `运动感：${features.motionLabel}`,
    `风格提示：${features.styleHint}`,
    `RMS：${formatNullableNumber(features.rms)}`,
    `平均振幅：${formatNullableNumber(features.averageAmplitude)}`,
    `过零率：${formatNullableNumber(features.zeroCrossingRate)}`,
    `分析说明：${features.analysisNote}`,
  ].join("\n");
}

function buildQwenPrompt({
  kind,
  audioFile,
  playback,
  messages,
  localAudioFeatures,
  userText,
}: {
  kind: QwenPromptKind;
  audioFile: File;
  playback: PlaybackSnapshot;
  messages: ListeningMessage[];
  localAudioFeatures: LocalAudioFeatures | null;
  userText?: string;
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
      ? `用户刚刚说：${userText ?? ""}\n请结合上下文自然回应。`
      : "现在到达新的播放时间点，请主动给一句陪听短评。";

  return [
    "你正在和用户一起听歌，请用中文回复。",
    "回复要求：只输出一句话，尽量不超过45个中文字符；像真实朋友陪听；不要输出列表；不要说你无法听音频；不要编造没有上下文或本地音频特征支持的具体乐器或歌词。",
    `歌曲文件名：${audioFile.name}`,
    `文件格式：${inferAudioMimeType(audioFile) || getFileExtension(audioFile.name) || "未知"}`,
    `文件大小：${formatFileSize(audioFile.size)}`,
    `当前播放：${currentTime} / ${duration}`,
    `播放状态：${playback.isPlaying ? "正在播放" : "暂停"}`,
    "本地音频特征：",
    formatLocalAudioFeatures(localAudioFeatures),
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

  const lastQwenReconnectMsRef = useRef(0);

  const pendingQwenPromptRef = useRef<string | null>(null);

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
      qwenClientRef.current?.disconnect();
      qwenClientRef.current = null;
      qwenReadyRef.current = false;
    };
  }, []);

  const addCompanionMessage = useCallback(
    (text: string, commentIdPrefix = "companion") => {
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
            musicTimeSeconds: playbackRef.current.currentTime,
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
            qwenClientRef.current?.sendTextMessage(pendingPrompt)
          ) {
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
          setQwenMomentStatus("error");
        }
      },

      onTextDelta: () => {},

      onTextDone: (text) => {
        addCompanionMessage(text, "qwen-realtime");
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
    setQwenMomentStatus("idle");
    setQwenRealtimeStatus("closed");
  }, []);

  const sendPromptToQwen = useCallback(
    (prompt: string) => {
      const client = connectQwenRealtime();

      setCompanionReplyStatus("thinking");
      setCompanionReplyError("");
      setQwenRealtimeError("");

      if (client.isReady() && client.sendTextMessage(prompt)) {
        setCompanionReplyStatus("streaming");
        setQwenMomentStatus("commenting");
        return true;
      }

      pendingQwenPromptRef.current = prompt;
      setQwenMomentStatus("commenting");
      return false;
    },
    [connectQwenRealtime],
  );

  const resetListeningSession = useCallback(() => {
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
      getFileExtension(file.name) === ".m4a";

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

    if (!playback.isPlaying || playback.isSeeking) {
      return;
    }

    const currentSecond = Math.floor(playback.currentTime);

    if (currentSecond < 8) {
      return;
    }

    if (
      currentSecond - lastRealtimeCommentSecondRef.current <
      18
    ) {
      return;
    }

    lastRealtimeCommentSecondRef.current = currentSecond;
    sendPromptToQwen(
      buildQwenPrompt({
        kind: "proactive_comment",
        audioFile,
        playback,
        messages: listeningMessagesRef.current,
        localAudioFeatures,
      }),
    );
  }, [
    audioFile,
    playback,
    playback.currentTime,
    playback.isPlaying,
    playback.isSeeking,
    sendPromptToQwen,
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

    sendPromptToQwen(
      buildQwenPrompt({
        kind: "user_reply",
        audioFile,
        playback: playbackRef.current,
        messages: nextMessages,
        localAudioFeatures,
        userText: cleanText,
      }),
    );
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

                sendPromptToQwen(
                  buildQwenPrompt({
                    kind: "proactive_comment",
                    audioFile,
                    playback: playbackRef.current,
                    messages: listeningMessagesRef.current,
                    localAudioFeatures,
                  }),
                );
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
