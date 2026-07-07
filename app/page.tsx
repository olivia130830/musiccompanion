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
} from "@/utils/qwenRealtimeClient";

import AudioUploader from "@/components/AudioUploader";
import CurrentComment from "@/components/CurrentComment";
import ListeningHistory from "@/components/ListeningHistory";
import MusicPlayer from "@/components/MusicPlayer";
import UserReplyBox from "@/components/UserReplyBox";

import { demoComments } from "@/data/demoComments";

import { useCommentScheduler } from "@/hooks/useCommentScheduler";
import { useLocalAudioFeatures } from "@/hooks/useLocalAudioFeatures";

import type {
  CommentFeedback,
  CompanionTone,
  DemoComment,
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

function includesAny(
  text: string,
  keywords: string[],
): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function inferCompanionTone(text: string): CompanionTone {
  const normalized = text.trim().toLowerCase();

  if (
    includesAny(normalized, [
      "孤独",
      "难过",
      "悲伤",
      "伤感",
      "压抑",
      "emo",
      "失落",
      "沉重",
      "想哭",
    ])
  ) {
    return "sad";
  }

  if (
    includesAny(normalized, [
      "燃",
      "炸",
      "爽",
      "激动",
      "热血",
      "强",
      "冲",
      "快",
      "有劲",
      "震撼",
    ])
  ) {
    return "excited";
  }

  if (
    includesAny(normalized, [
      "温暖",
      "治愈",
      "可爱",
      "甜",
      "亲切",
      "安心",
      "柔和",
      "浪漫",
    ])
  ) {
    return "warm";
  }

  if (
    includesAny(normalized, [
      "安静",
      "轻",
      "慢",
      "柔",
      "平静",
      "空",
      "静",
      "空灵",
      "氛围",
    ])
  ) {
    return "quiet";
  }

  if (
    includesAny(normalized, [
      "为什么",
      "怎么",
      "咋",
      "哪里",
      "是不是",
      "有没有",
      "？",
      "?",
    ])
  ) {
    return "curious";
  }

  return "unknown";
}

function adaptCommentToTone(
  comment: DemoComment,
  tone: CompanionTone,
): DemoComment {
  if (tone === "unknown") {
    return comment;
  }

  const original = comment.comment.trim();

  if (!original) {
    return comment;
  }

  const hasToneAlready = includesAny(original, [
    "安静",
    "轻",
    "慢",
    "燃",
    "冲",
    "孤独",
    "沉",
    "温暖",
    "靠近",
    "好奇",
    "变化",
  ]);

  if (hasToneAlready) {
    return comment;
  }

  const shouldAdapt =
    comment.eventType === "emotion_shift" ||
    comment.eventType === "pause" ||
    comment.eventType === "rhythm_entry";

  if (!shouldAdapt) {
    return comment;
  }

  const tonePrefix: Record<
    Exclude<CompanionTone, "unknown">,
    string
  > = {
    quiet: "这里可以轻一点听，",
    excited: "这里有点推起来了，",
    sad: "这里有点往心里沉，",
    warm: "这里有点暖起来，",
    curious: "这里的变化挺值得听，",
  };

  const nextComment = `${tonePrefix[tone]}${original}`;

  return {
    ...comment,
    comment:
      nextComment.length > 40
        ? nextComment.slice(0, 40)
        : nextComment,
  };
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
    return "Realtime 已连接。当前不会再发送音乐 PCM，避免 1011 断连。";
  }

  if (status === "commenting") {
    return "正在生成主动陪听短评。";
  }

  if (status === "error") {
    return "Realtime 连接不稳定，当前只保留连接状态。";
  }

  return "播放时会自动生成主动陪听短评。";
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

function pickByIndex<T>(items: T[], index: number) {
  return items[Math.abs(index) % items.length];
}

function createProactiveRealtimeComment(
  playback: PlaybackSnapshot,
  recentMessages: ListeningMessage[],
) {
  const currentTime = Math.floor(playback.currentTime);

  const recentUserText = recentMessages
    .filter((message) => message.sender === "user")
    .slice(-4)
    .map((message) => message.text)
    .join(" ");

  const recentCompanionText = recentMessages
    .filter((message) => message.sender === "companion")
    .slice(-6)
    .map((message) => message.text)
    .join(" ");

  const avoidRepeated = (candidates: string[]) => {
    const normalizedRecent = normalizeText(recentCompanionText);

    const filtered = candidates.filter((candidate) => {
      const normalizedCandidate = normalizeText(candidate);

      return !normalizedRecent.includes(normalizedCandidate);
    });

    if (filtered.length > 0) {
      return pickByIndex(filtered, currentTime);
    }

    return pickByIndex(candidates, currentTime + recentMessages.length);
  };

  if (
    recentUserText.includes("琵琶") ||
    recentUserText.includes("民乐") ||
    recentUserText.includes("中国风")
  ) {
    return avoidRepeated([
      "琵琶进来后，背景一下子有了更清楚的颗粒感。",
      "这里的民乐音色不是主角，但很会补氛围。",
      "这个琵琶音色像是在背景里点了一下光。",
      "它不是突然抢出来，而是在后面悄悄把质感加厚了。",
    ]);
  }

  if (
    recentUserText.includes("主歌") ||
    recentUserText.includes("第二段") ||
    recentUserText.includes("副歌")
  ) {
    return avoidRepeated([
      "到这一段之后，结构感比前面更清楚了。",
      "这里像是进入了新的段落，但情绪没有完全断开。",
      "这一段和前面相比，更像是在把叙述继续往前推。",
      "这里不是单纯重复，段落的重心已经换了一点。",
    ]);
  }

  if (
    recentUserText.includes("安静") ||
    recentUserText.includes("轻") ||
    recentUserText.includes("空")
  ) {
    return avoidRepeated([
      "这个开头的留白感挺明显，不是空，是在等后面进来。",
      "这里的安静更像是在铺空间，不是单纯声音少。",
      "开头这段可以听它怎么慢慢把距离拉开。",
      "这段的轻不是弱，而是把情绪压得比较低。",
    ]);
  }

  if (currentTime < 30) {
    return avoidRepeated([
      "开头这段像是在把空间慢慢撑开。",
      "这里先别急着找高潮，先听它怎么铺底。",
      "这一段的进入感挺明显，像是在慢慢拉你进去。",
      "这里可以先听音色，不一定只听旋律。",
    ]);
  }

  if (currentTime < 70) {
    return avoidRepeated([
      "这里的层次比前面更清楚了一点。",
      "这段有一点往前推的感觉，但还没完全爆开。",
      "这里可以重点听背景里的细节变化。",
      "这一段像是在把情绪往更深的地方带。",
      "这里不是突然变强，而是慢慢加压。",
    ]);
  }

  if (currentTime < 120) {
    return avoidRepeated([
      "这一段的重点开始从铺垫转到表达了。",
      "这里可以听到背景和主线之间有一点拉扯。",
      "这段更像是在把前面的情绪重新组织起来。",
      "它没有完全换气质，但质感已经比前面更厚。",
      "这里的变化比较细，不是那种一下子跳出来的变化。",
    ]);
  }

  return avoidRepeated([
    "这里可以回头对比前面，能听到情绪已经变了。",
    "这一段更像是在延续氛围，不是单纯重复。",
    "这里的重点可能不是旋律，而是整体的包围感。",
    "这段有点像把前面的情绪重新整理了一遍。",
    "现在听它的尾巴会更有意思，很多细节藏在后面。",
  ]);
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

  const [activeComments, setActiveComments] = useState<
    DemoComment[]
  >([]);

  const [companionTone, setCompanionTone] =
    useState<CompanionTone>("unknown");

  const [companionReplyStatus, setCompanionReplyStatus] =
    useState<CompanionReplyStatus>("idle");

  const [companionReplyError, setCompanionReplyError] =
    useState("");

  const [listeningSessionId, setListeningSessionId] =
    useState(0);

  const [qwenRealtimeStatus, setQwenRealtimeStatus] =
    useState<QwenRealtimeStatus | "not_started">(
      "not_started",
    );

  const [qwenRealtimeError, setQwenRealtimeError] =
    useState("");

  const [qwenMomentStatus, setQwenMomentStatus] =
    useState<QwenMomentStatus>("idle");

  const qwenClientRef = useRef<QwenRealtimeClient | null>(
    null,
  );

  const qwenReadyRef = useRef(false);

  const lastRealtimeCommentSecondRef = useRef(0);

  const lastQwenReconnectMsRef = useRef(0);

  const playbackRef =
    useRef<PlaybackSnapshot>(INITIAL_PLAYBACK);

  const listeningMessagesRef = useRef<ListeningMessage[]>([]);

  const {
    status: localFeatureStatus,
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

  const schedulerKey = [
    trackKey,
    listeningSessionId,
  ].join("-");

  const hasAudio = Boolean(audioFile);

  const companionComments = useMemo(() => {
    return activeComments.map((comment) =>
      adaptCommentToTone(comment, companionTone),
    );
  }, [activeComments, companionTone]);

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
    if (
      qwenClientRef.current &&
      qwenClientRef.current.isReady()
    ) {
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
        }

        if (
          status === "closed" ||
          status === "error"
        ) {
          qwenReadyRef.current = false;
          qwenClientRef.current = null;
          setQwenMomentStatus("error");
        }
      },

      onTextDelta: () => {},

      onTextDone: (text) => {
        addCompanionMessage(text, "qwen-realtime");
      },

      onError: (message) => {
        setQwenRealtimeError(message);
        qwenReadyRef.current = false;
        qwenClientRef.current = null;
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
    setQwenMomentStatus("idle");
    setQwenRealtimeStatus("closed");
  }, []);

  const handleCommentTriggered = useCallback(
    (comment: DemoComment) => {
      setListeningMessages((previousMessages) => {
        const alreadyExists = previousMessages.some(
          (message) =>
            message.sender === "companion" &&
            message.commentId === comment.id,
        );

        if (alreadyExists) {
          return previousMessages;
        }

        const newMessage: ListeningMessage = {
          id: `companion-${comment.id}`,
          sender: "companion",
          text: comment.comment,
          musicTimeSeconds: comment.timeSeconds,
          commentId: comment.id,
        };

        return [...previousMessages, newMessage];
      });
    },
    [],
  );

  const { currentComment } = useCommentScheduler({
    comments: companionComments,
    currentTime: playback.currentTime,
    isPlaying: playback.isPlaying,
    isSeeking: playback.isSeeking,
    trackKey: schedulerKey,
    onCommentTriggered: handleCommentTriggered,
  });

  const resetListeningSession = useCallback(() => {
    setPlayback(INITIAL_PLAYBACK);
    setListeningMessages([]);
    setFeedbackByCommentId({});
    setActiveComments([]);
    setCompanionTone("unknown");
    setCompanionReplyStatus("idle");
    setCompanionReplyError("");
    setQwenRealtimeError("");
    setQwenMomentStatus("idle");
    resetLocalAudioFeatures();

    lastRealtimeCommentSecondRef.current = 0;

    setListeningSessionId((previous) => previous + 1);
  }, [resetLocalAudioFeatures]);

  const handleUseDemo = () => {
    setActiveComments(demoComments);
    setListeningSessionId((previous) => previous + 1);
  };

  const handleFileSelect = (file: File) => {
    setAudioFile(file);
    resetListeningSession();

    void analyzeLocalAudioFeatures(file).catch((error) => {
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
    setQwenMomentStatus("commenting");

    const text = createProactiveRealtimeComment(
      playback,
      listeningMessagesRef.current,
    );

    addCompanionMessage(text, "realtime-style");

    window.setTimeout(() => {
      setQwenMomentStatus(
        qwenReadyRef.current ? "connected" : "idle",
      );
    }, 600);
  }, [
    addCompanionMessage,
    audioFile,
    playback,
    playback.currentTime,
    playback.isPlaying,
    playback.isSeeking,
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

    const nextTone = inferCompanionTone(cleanText);

    if (nextTone !== "unknown") {
      setCompanionTone(nextTone);
    }

    setListeningMessages((previousMessages) => [
      ...previousMessages,
      newMessage,
    ]);

    setCompanionReplyStatus("idle");
    setCompanionReplyError("");
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
              ? "选择一首音乐，AI会陪你聊它的听感、情绪和变化。"
              : localFeatureStatus === "analyzing"
                ? "正在理解这首歌的听感，不影响你直接播放。"
                : "音乐已准备好。你可以直接播放，AI会按播放时间主动短评。"}
          </p>

          <AudioUploader
            disabled={false}
            onFileSelect={handleFileSelect}
          />
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
                const text = createProactiveRealtimeComment(
                  playbackRef.current,
                  listeningMessagesRef.current,
                );

                addCompanionMessage(text, "manual-realtime-style");
              }}
            >
              手动生成当前短评
            </button>
          )}
        </section>

        <MusicPlayer
          key={`player-${trackKey}`}
          audioFile={audioFile}
          onPlaybackStateChange={setPlayback}
        />

        <CurrentComment
          key={`current-comment-${
            currentComment?.id ?? schedulerKey
          }`}
          comment={currentComment}
          hasAudio={hasAudio}
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
              ? "AI正在理解你的这句话…"
              : companionReplyStatus === "streaming"
                ? "AI正在回复中…"
                : companionReplyStatus === "error"
                  ? companionReplyError
                  : "你发的话会作为听歌上下文，不再触发普通回复接口。"}
          </div>
        )}

        <UserReplyBox
          key={`reply-box-${trackKey}`}
          disabled={!audioFile}
          onSend={handleUserSend}
        />

        {hasAudio && activeComments.length === 0 && (
          <button
            type="button"
            style={styles.demoButton}
            onClick={handleUseDemo}
          >
            使用演示时间点评论
          </button>
        )}

        <footer style={styles.footer}>
          当前版本：普通回复接口已关闭；Realtime 只保持连接状态，不再发送音乐
          PCM，避免 1011 断连。
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