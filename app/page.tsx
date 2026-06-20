"use client";

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

import {
  upload,
} from "@vercel/blob/client";

import AudioAnalysisPanel from "@/components/AudioAnalysisPanel";
import AudioUploader from "@/components/AudioUploader";
import CurrentComment from "@/components/CurrentComment";
import ListeningHistory from "@/components/ListeningHistory";
import MusicPlayer from "@/components/MusicPlayer";
import UserReplyBox from "@/components/UserReplyBox";

import {
  demoComments,
} from "@/data/demoComments";

import {
  useCommentScheduler,
} from "@/hooks/useCommentScheduler";

import type {
  AudioAnalysisResult,
  AudioAnalysisStatus,
  CommentFeedback,
  DemoComment,
  ListeningMessage,
  PlaybackSnapshot,
} from "@/types/music";

const INITIAL_PLAYBACK: PlaybackSnapshot =
  {
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    isSeeking: false,
  };

function createMessageId(): string {
  if (
    typeof crypto !==
      "undefined" &&
    "randomUUID" in crypto
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function sanitizeUploadFileName(
  fileName: string,
): string {
  const cleaned = fileName
    .replace(
      /[^\p{L}\p{N}._ -]/gu,
      "-",
    )
    .replace(/\s+/g, "-")
    .slice(0, 100);

  return cleaned || "audio";
}

function getAudioMimeType(
  file: File,
): string {
  if (file.type) {
    return file.type;
  }

  const extension =
    file.name
      .split(".")
      .pop()
      ?.toLowerCase() ?? "";

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

async function readErrorMessage(
  response: Response,
): Promise<string> {
  try {
    const data =
      (await response.json()) as {
        error?: unknown;
      };

    if (
      typeof data.error ===
        "string" &&
      data.error.trim()
    ) {
      return data.error;
    }
  } catch {
    // 使用默认错误。
  }

  return `请求失败（HTTP ${response.status}）。`;
}

export default function Home() {
  const [
    audioFile,
    setAudioFile,
  ] =
    useState<File | null>(
      null,
    );

  const [
    playback,
    setPlayback,
  ] =
    useState<PlaybackSnapshot>(
      INITIAL_PLAYBACK,
    );

  const [
    listeningMessages,
    setListeningMessages,
  ] = useState<
    ListeningMessage[]
  >([]);

  const [
    feedbackByCommentId,
    setFeedbackByCommentId,
  ] = useState<
    Record<
      string,
      CommentFeedback
    >
  >({});

  const [
    activeComments,
    setActiveComments,
  ] = useState<
    DemoComment[]
  >([]);

  const [
    analysisStatus,
    setAnalysisStatus,
  ] =
    useState<AudioAnalysisStatus>(
      "idle",
    );

  const [
    analysisSummary,
    setAnalysisSummary,
  ] = useState("");

  const [
    analysisError,
    setAnalysisError,
  ] = useState("");

  const [
    listeningSessionId,
    setListeningSessionId,
  ] = useState(0);

  const trackKey =
    useMemo(() => {
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
    analysisStatus ===
      "uploading" ||
    analysisStatus ===
      "analyzing";

  const hasAudio =
    Boolean(audioFile);

  const handleCommentTriggered =
    useCallback(
      (
        comment: DemoComment,
      ) => {
        setListeningMessages(
          (
            previousMessages,
          ) => {
            const alreadyExists =
              previousMessages.some(
                (message) =>
                  message.sender ===
                    "companion" &&
                  message.commentId ===
                    comment.id,
              );

            if (alreadyExists) {
              return previousMessages;
            }

            const newMessage: ListeningMessage =
              {
                id: `companion-${comment.id}`,

                sender:
                  "companion",

                text:
                  comment.comment,

                musicTimeSeconds:
                  comment.timeSeconds,

                commentId:
                  comment.id,
              };

            return [
              ...previousMessages,
              newMessage,
            ];
          },
        );
      },
      [],
    );

  const { currentComment } =
    useCommentScheduler({
      comments:
        activeComments,

      currentTime:
        playback.currentTime,

      isPlaying:
        playback.isPlaying,

      isSeeking:
        playback.isSeeking,

      trackKey:
        schedulerKey,

      onCommentTriggered:
        handleCommentTriggered,
    });

  const resetListeningSession =
    useCallback(() => {
      setPlayback(
        INITIAL_PLAYBACK,
      );

      setListeningMessages(
        [],
      );

      setFeedbackByCommentId(
        {},
      );

      setActiveComments([]);
      setAnalysisSummary("");
      setAnalysisError("");

      setListeningSessionId(
        (previous) =>
          previous + 1,
      );
    }, []);

  const analyzeFile =
    useCallback(
      async (file: File) => {
        setAnalysisStatus(
          "uploading",
        );

        setAnalysisError("");
        setAnalysisSummary("");
        setActiveComments([]);

        try {
          const safeName =
            sanitizeUploadFileName(
              file.name,
            );

          const pathname = [
            "music-analysis",
            `${Date.now()}-${safeName}`,
          ].join("/");

          const temporaryBlob =
            await upload(
              pathname,
              file,
              {
                access:
                  "private",

                handleUploadUrl:
                  "/api/upload-audio",

                contentType:
                  getAudioMimeType(
                    file,
                  ),

                multipart:
                  file.size >
                  5 *
                    1024 *
                    1024,
              },
            );

          setAnalysisStatus(
            "analyzing",
          );

          const response =
            await fetch(
              "/api/analyze-audio",
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body:
                  JSON.stringify(
                    {
                      blobPathname:
                        temporaryBlob.pathname,

                      fileName:
                        file.name,

                      mimeType:
                        getAudioMimeType(
                          file,
                        ),
                    },
                  ),
              },
            );

          if (!response.ok) {
            throw new Error(
              await readErrorMessage(
                response,
              ),
            );
          }

          const result =
            (await response.json()) as AudioAnalysisResult;

          if (
            !Array.isArray(
              result.comments,
            ) ||
            result.comments
              .length === 0
          ) {
            throw new Error(
              "AI没有生成可用的时间点评论。",
            );
          }

          setActiveComments(
            result.comments,
          );

          setAnalysisSummary(
            result.summary,
          );

          /**
           * 让评论调度以分析完成时的播放位置重新建立。
           *
           * 已经播放过去的评论会被跳过，
           * 后续时间点仍然会正常触发。
           */
          setListeningSessionId(
            (previous) =>
              previous + 1,
          );

          setAnalysisStatus(
            "success",
          );
        } catch (error) {
          console.error(
            "音频分析失败：",
            error,
          );

          setAnalysisStatus(
            "error",
          );

          setAnalysisError(
            error instanceof Error
              ? error.message
              : "音频分析失败，请稍后重试。",
          );
        }
      },
      [],
    );

  const handleFileSelect = (
    file: File,
  ) => {
    setAudioFile(file);

    resetListeningSession();

    /**
     * 用户立即获得播放器，
     * AI分析在后台运行。
     */
    void analyzeFile(file);
  };

  const handleRetry = () => {
    if (!audioFile) {
      return;
    }

    setAnalysisError("");
    setAnalysisSummary("");
    setActiveComments([]);

    void analyzeFile(
      audioFile,
    );
  };

  const handleUseDemo =
    () => {
      setActiveComments(
        demoComments,
      );

      setAnalysisSummary(
        "当前使用的是演示评论，用于测试时间轴和互动功能。",
      );

      setListeningSessionId(
        (previous) =>
          previous + 1,
      );

      setAnalysisStatus(
        "fallback",
      );
    };

  const handleFeedbackChange = (
    commentId: string,
    feedback:
      CommentFeedback,
  ) => {
    setFeedbackByCommentId(
      (
        previousFeedback,
      ) => ({
        ...previousFeedback,

        [commentId]:
          feedback,
      }),
    );
  };

  const handleUserSend = (
    text: string,
  ) => {
    if (!audioFile) {
      return;
    }

    const cleanText =
      text.trim();

    if (!cleanText) {
      return;
    }

    const newMessage: ListeningMessage =
      {
        id:
          createMessageId(),

        sender:
          "user",

        text:
          cleanText,

        musicTimeSeconds:
          playback.currentTime,
      };

    setListeningMessages(
      (
        previousMessages,
      ) => [
        ...previousMessages,
        newMessage,
      ],
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

      <section
        style={
          styles.container
        }
      >
        <header
          style={styles.header}
        >
          <div
            style={
              styles.brandBadge
            }
          >
            <span
              style={
                styles.brandDot
              }
              aria-hidden="true"
            />

            MusicCompanion
          </div>

          <h1
            style={styles.title}
          >
            有人和你一起听
          </h1>

          <p
            style={
              styles.subtitle
            }
          >
            音乐发生的时候，也有人听见。
          </p>
        </header>

        <section
          style={
            styles.heroCard
          }
        >
          <p
            style={
              styles.description
            }
          >
            {!audioFile
              ? "选择一首音乐，播放可以立即开始，AI会在后台准备评论。"
              : isWorking
                ? "你可以先听音乐，AI正在后台理解这首作品。"
                : analysisStatus ===
                    "success"
                  ? "AI评论已经准备完成，共同聆听正在继续。"
                  : analysisStatus ===
                      "error"
                    ? "音乐仍可正常播放，AI分析可以稍后重试。"
                    : "已经可以开始共同聆听。"}
          </p>

          <AudioUploader
            disabled={
              isWorking
            }
            onFileSelect={
              handleFileSelect
            }
          />
        </section>

        <AudioAnalysisPanel
          status={
            analysisStatus
          }
          summary={
            analysisSummary
          }
          error={
            analysisError
          }
          commentCount={
            activeComments.length
          }
          hasAudio={
            hasAudio
          }
          onRetry={
            handleRetry
          }
          onUseDemo={
            handleUseDemo
          }
        />

        <MusicPlayer
          key={`player-${trackKey}`}
          audioFile={
            audioFile
          }
          onPlaybackStateChange={
            setPlayback
          }
        />

        <CurrentComment
          key={`current-comment-${
            currentComment?.id ??
            schedulerKey
          }`}
          comment={
            currentComment
          }
          hasAudio={
            hasAudio
          }
        />

        <ListeningHistory
          messages={
            listeningMessages
          }
          feedbackByCommentId={
            feedbackByCommentId
          }
          onFeedbackChange={
            handleFeedbackChange
          }
        />

        <UserReplyBox
          key={`reply-box-${trackKey}`}
          disabled={
            !audioFile
          }
          onSend={
            handleUserSend
          }
        />

        <footer
          style={styles.footer}
        >
          选择音乐后可以立即播放；AI分析在后台进行，完成后自动加入后续时间点评论。
        </footer>
      </section>
    </main>
  );
}

const styles: Record<
  string,
  CSSProperties
> = {
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
    padding:
      "20px 10px 8px",
    textAlign: "center",
  },

  brandBadge: {
    width: "fit-content",
    margin:
      "0 auto 22px",
    padding: "7px 13px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    border:
      "1px solid rgba(113, 137, 180, 0.18)",
    borderRadius: "999px",
    background:
      "rgba(255, 255, 255, 0.68)",
    boxShadow:
      "0 8px 28px rgba(54, 89, 142, 0.08)",
    backdropFilter:
      "blur(16px)",
    color:
      "var(--text-secondary)",
    fontSize: "12px",
    fontWeight: 400,
    letterSpacing:
      "0.04em",
  },

  brandDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background:
      "linear-gradient(135deg, #5d8cff, #a47aff)",
    boxShadow:
      "0 0 14px rgba(93, 140, 255, 0.65)",
  },

  title: {
    margin:
      "0 0 12px",
    color:
      "var(--text-primary)",
    fontSize:
      "clamp(34px, 7vw, 52px)",
    fontWeight: 400,
    lineHeight: 1.12,
    letterSpacing:
      "-0.045em",
  },

  subtitle: {
    margin: 0,
    color:
      "var(--text-secondary)",
    fontSize: "15px",
    lineHeight: 1.7,
  },

  heroCard: {
    width: "100%",
    maxWidth: "520px",
    display: "flex",
    flexDirection:
      "column",
    alignItems: "center",
    gap: "18px",
    padding: "22px",
    border:
      "1px solid rgba(116, 139, 181, 0.16)",
    borderRadius: "24px",
    background:
      "rgba(255, 255, 255, 0.64)",
    boxShadow:
      "0 18px 60px rgba(74, 107, 163, 0.1)",
    backdropFilter:
      "blur(22px)",
  },

  description: {
    minHeight: "21px",
    margin: 0,
    color:
      "var(--text-secondary)",
    fontSize: "14px",
    lineHeight: 1.7,
    textAlign: "center",
  },

  footer: {
    maxWidth: "520px",
    padding:
      "8px 12px 18px",
    color:
      "var(--text-tertiary)",
    fontSize: "11px",
    lineHeight: 1.7,
    textAlign: "center",
  },
};