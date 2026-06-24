"use client";

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

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

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as {
      error?: unknown;
    };

    if (
      typeof data.error === "string" &&
      data.error.trim()
    ) {
      return data.error;
    }
  } catch {
    try {
      const text = await response.text();

      if (text.trim()) {
        return text.trim();
      }
    } catch {
      // 使用默认错误。
    }
  }

  return `请求失败（HTTP ${response.status}）。`;
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
    resetLocalAudioFeatures();

    setListeningSessionId((previous) => previous + 1);
  }, [resetLocalAudioFeatures]);

  const handleUseDemo = () => {
    setActiveComments(demoComments);
    setListeningSessionId((previous) => previous + 1);
  };

  const handleFileSelect = (file: File) => {
    setAudioFile(file);
    resetListeningSession();

    /*
     * 这里只做隐藏的本地听感分析。
     * 不显示给用户，不调用付费听歌识曲 API。
     */
    void analyzeLocalAudioFeatures(file).catch((error) => {
      console.warn("本地听感分析失败：", error);
    });
  };

  const handleFeedbackChange = (
    commentId: string,
    feedback: CommentFeedback,
  ) => {
    setFeedbackByCommentId((previousFeedback) => ({
      ...previousFeedback,
      [commentId]: feedback,
    }));
  };

  const updateCompanionStreamingMessage = (
    messageId: string,
    nextText: string,
  ) => {
    setListeningMessages((previousMessages) =>
      previousMessages.map((message) => {
        if (
          message.id === messageId &&
          message.sender === "companion"
        ) {
          return {
            ...message,
            text: nextText,
          };
        }

        return message;
      }),
    );
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
      musicTimeSeconds: playback.currentTime,
    };

    const nextTone = inferCompanionTone(cleanText);

    if (nextTone !== "unknown") {
      setCompanionTone(nextTone);
    }

    setListeningMessages((previousMessages) => [
      ...previousMessages,
      newMessage,
    ]);

    setCompanionReplyStatus("thinking");
    setCompanionReplyError("");

    try {
      const streamingMessageId = createMessageId();
      const streamingCommentId = `stage9-reply-${Date.now()}`;
      let hasCreatedCompanionMessage = false;
      let accumulatedText = "";

      const messagesForApi = [
        ...listeningMessages,
        newMessage,
      ].slice(-8);

      const response = await fetch("/api/companion-reply", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          userMessage: cleanText,
          currentTimeSeconds: playback.currentTime,
          audioSummary:
            "当前版本不做歌名识别，也不会调用付费听歌识曲API。请不要编造歌名、歌手或专辑。",
          currentComment,
          recentMessages: messagesForApi,
          companionTone:
            nextTone !== "unknown"
              ? nextTone
              : companionTone,

          /*
           * 隐藏上下文：前端提前分析，但页面不展示。
           */
          localAudioFeatures,
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      if (!response.body) {
        throw new Error("AI回复没有返回可读取的内容。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, {
          stream: true,
        });

        if (!chunk) {
          continue;
        }

        accumulatedText += chunk;

        const visibleText = accumulatedText.trim();

        if (!visibleText) {
          continue;
        }

        if (!hasCreatedCompanionMessage) {
          hasCreatedCompanionMessage = true;

          setListeningMessages((previousMessages) => [
            ...previousMessages,
            {
              id: streamingMessageId,
              sender: "companion",
              text: visibleText,
              musicTimeSeconds: playback.currentTime,
              commentId: streamingCommentId,
            },
          ]);

          setCompanionReplyStatus("streaming");
        } else {
          updateCompanionStreamingMessage(
            streamingMessageId,
            visibleText,
          );
        }
      }

      const finalText = accumulatedText.trim();

      if (!finalText) {
        throw new Error("AI没有生成可显示的回复。");
      }

      updateCompanionStreamingMessage(
        streamingMessageId,
        finalText,
      );

      setCompanionReplyStatus("idle");
      setCompanionReplyError("");
    } catch (error) {
      console.error("生成陪伴回复失败：", error);

      setCompanionReplyStatus("error");

      const message =
        error instanceof Error
          ? error.message
          : "这条AI回复没有生成成功，可以再发一次。";

      setCompanionReplyError(message);
    }
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
                : "音乐已准备好。你可以直接说你的感觉，也可以问它像什么风格。"}
          </p>

          <AudioUploader
            disabled={false}
            onFileSelect={handleFileSelect}
          />
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
                  : "你可以说一句听感，AI会结合隐藏的音乐特征回应。"}
          </div>
        )}

        <UserReplyBox
          key={`reply-box-${trackKey}`}
          disabled={
            !audioFile ||
            companionReplyStatus === "thinking" ||
            companionReplyStatus === "streaming"
          }
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
          阶段9：当前版本不做歌名识别；本地听感分析只作为隐藏上下文；DeepSeek负责陪伴式回复。
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