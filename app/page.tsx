"use client";

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

import { upload } from "@vercel/blob/client";

import AudioAnalysisPanel from "@/components/AudioAnalysisPanel";
import AudioUploader from "@/components/AudioUploader";
import CurrentComment from "@/components/CurrentComment";
import ListeningHistory from "@/components/ListeningHistory";
import MusicPlayer from "@/components/MusicPlayer";
import UserReplyBox from "@/components/UserReplyBox";

import { demoComments } from "@/data/demoComments";

import { useCommentScheduler } from "@/hooks/useCommentScheduler";
import { useLocalAudioFeatures } from "@/hooks/useLocalAudioFeatures";

import type {
  AudioAnalysisResult,
  AudioAnalysisStatus,
  CommentFeedback,
  CompanionTone,
  DemoComment,
  ListeningMessage,
  LocalAudioFeatures,
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

function sanitizeUploadFileName(fileName: string): string {
  const cleaned = fileName
    .replace(/[^\p{L}\p{N}._ -]/gu, "-")
    .replace(/\s+/g, "-")
    .slice(0, 100);

  return cleaned || "audio";
}

function getAudioMimeType(file: File): string {
  if (file.type) {
    return file.type;
  }

  const extension =
    file.name.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "wav") {
    return "audio/wav";
  }

  if (extension === "m4a") {
    return "audio/mp4";
  }

  if (extension === "aac") {
    return "audio/aac";
  }

  return "audio/mpeg";
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

function needsTrackIdentity(text: string): boolean {
  const normalized = text.trim().toLowerCase();

  return includesAny(normalized, [
    "这首歌叫什么",
    "歌名",
    "叫什么歌",
    "这是什么歌",
    "识别",
    "听出来",
    "听得出来",
    "谁唱的",
    "作者",
    "歌手",
    "专辑",
  ]);
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

  const [analysisStatus, setAnalysisStatus] =
    useState<AudioAnalysisStatus>("idle");

  const [analysisSummary, setAnalysisSummary] =
    useState("");

  const [analysisError, setAnalysisError] = useState("");

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

  const isWorking =
    analysisStatus === "uploading" ||
    analysisStatus === "analyzing";

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
    setAnalysisStatus("idle");
    setAnalysisSummary("");
    setAnalysisError("");
    resetLocalAudioFeatures();

    setListeningSessionId((previous) => previous + 1);
  }, [resetLocalAudioFeatures]);

  const analyzeIdentityWithAudD = useCallback(
    async (file: File) => {
      setAnalysisStatus("uploading");
      setAnalysisError("");

      const safeName = sanitizeUploadFileName(file.name);

      const pathname = [
        "music-analysis",
        `${Date.now()}-${safeName}`,
      ].join("/");

      const temporaryBlob = await upload(pathname, file, {
        access: "private",
        handleUploadUrl: "/api/upload-audio",
        contentType: getAudioMimeType(file),
        multipart: file.size > 5 * 1024 * 1024,
      });

      setAnalysisStatus("analyzing");

      const response = await fetch("/api/analyze-audio", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          blobPathname: temporaryBlob.pathname,
          fileName: file.name,
          mimeType: getAudioMimeType(file),
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const result =
        (await response.json()) as AudioAnalysisResult;

      setAnalysisSummary(result.summary);
      setActiveComments(result.comments);
      setListeningSessionId((previous) => previous + 1);
      setAnalysisStatus("success");

      return result;
    },
    [],
  );

  const handleRetry = () => {
    if (!audioFile) {
      return;
    }

    setAnalysisError("");
    setAnalysisSummary("");
    setActiveComments([]);

    void analyzeIdentityWithAudD(audioFile).catch((error) => {
      console.error("AudD识别失败：", error);

      const message =
        error instanceof Error
          ? error.message
          : "AudD识别失败。";

      setAnalysisStatus("error");
      setAnalysisError(message);
    });
  };

  const handleUseDemo = () => {
    setActiveComments(demoComments);

    setAnalysisSummary(
      "当前使用的是演示评论，用于测试时间轴和互动功能。",
    );

    setListeningSessionId((previous) => previous + 1);

    setAnalysisStatus("fallback");
  };

  const handleFileSelect = (file: File) => {
    setAudioFile(file);

    resetListeningSession();

    setAnalysisStatus("idle");
    setAnalysisError("");
    setAnalysisSummary("");
    setActiveComments([]);

    void analyzeLocalAudioFeatures(file);
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

    let summaryForReply = analysisSummary;
    let commentsForReply = activeComments;
    let commentForReply = currentComment;

    try {
      if (
        needsTrackIdentity(cleanText) &&
        !analysisSummary.trim()
      ) {
        const identityResult =
          await analyzeIdentityWithAudD(audioFile);

        summaryForReply = identityResult.summary;
        commentsForReply = identityResult.comments;
        commentForReply =
          identityResult.comments.find((comment) => {
            return (
              Math.abs(
                comment.timeSeconds -
                  playback.currentTime,
              ) <= 12
            );
          }) ?? null;
      }

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
          audioSummary: summaryForReply,
          currentComment: commentForReply,
          recentMessages: messagesForApi,
          companionTone:
            nextTone !== "unknown"
              ? nextTone
              : companionTone,
          localAudioFeatures:
            localAudioFeatures satisfies LocalAudioFeatures | null,
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
              ? "选择一首音乐，播放可以立即开始。浏览器会先做本地听感分析。"
              : localFeatureStatus === "analyzing"
                ? "正在本地分析音乐能量、亮度和运动感，不影响播放。"
                : isWorking
                  ? "正在识别歌曲身份。这个过程可能会慢一点。"
                  : analysisStatus === "success"
                    ? "已获得歌曲识别结果，DeepSeek会结合本地听感分析一起回复。"
                    : analysisStatus === "error"
                      ? "歌曲识别暂时失败，但本地听感分析和普通聊天仍然可以继续。"
                      : "音乐已准备好。可以直接播放，也可以和AI聊当前听感。"}
          </p>

          <AudioUploader
            disabled={isWorking}
            onFileSelect={handleFileSelect}
          />
        </section>

        <AudioAnalysisPanel
          status={analysisStatus}
          summary={
            analysisSummary ||
            (localAudioFeatures
              ? `本地听感分析：能量${localAudioFeatures.energyLabel}；音色${localAudioFeatures.brightnessLabel}；运动感${localAudioFeatures.motionLabel}；风格倾向 ${localAudioFeatures.styleHint}。`
              : "")
          }
          error={analysisError}
          commentCount={activeComments.length}
          hasAudio={hasAudio}
          onRetry={handleRetry}
          onUseDemo={handleUseDemo}
        />

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
                  : "你可以随时说一句你的感觉，AI会结合本地听感分析回应。"}
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

        <footer style={styles.footer}>
          阶段9：AudD负责歌曲识别；浏览器本地分析听感特征；DeepSeek负责陪伴式回复。
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

  footer: {
    maxWidth: "520px",
    padding: "8px 12px 18px",
    color: "var(--text-tertiary)",
    fontSize: "11px",
    lineHeight: 1.7,
    textAlign: "center",
  },
};