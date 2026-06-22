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
  CompanionTone,
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

const STAGE9_WARMUP_COMMENT_ID =
  "stage9-warmup";

const STAGE9_ANALYSIS_READY_COMMENT_ID =
  "stage9-analysis-ready";

const STAGE9_FALLBACK_COMMENT_ID =
  "stage9-fallback";

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

function inferCompanionTone(
  text: string,
): CompanionTone {
  const normalized =
    text
      .trim()
      .toLowerCase();

  if (!normalized) {
    return "unknown";
  }

  const quietWords = [
    "安静",
    "轻",
    "慢",
    "柔",
    "平静",
    "舒服",
    "淡",
    "空",
    "松",
    "静",
  ];

  const excitedWords = [
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
  ];

  const sadWords = [
    "孤独",
    "难过",
    "悲伤",
    "伤感",
    "压抑",
    "emo",
    "失落",
    "沉重",
    "想哭",
  ];

  const warmWords = [
    "温暖",
    "治愈",
    "可爱",
    "甜",
    "亲切",
    "安心",
    "柔和",
    "浪漫",
  ];

  const curiousWords = [
    "为什么",
    "咋",
    "怎么",
    "感觉",
    "好像",
    "是不是",
    "哪里",
    "?",
    "？",
  ];

  if (
    sadWords.some((word) =>
      normalized.includes(word),
    )
  ) {
    return "sad";
  }

  if (
    excitedWords.some((word) =>
      normalized.includes(word),
    )
  ) {
    return "excited";
  }

  if (
    warmWords.some((word) =>
      normalized.includes(word),
    )
  ) {
    return "warm";
  }

  if (
    quietWords.some((word) =>
      normalized.includes(word),
    )
  ) {
    return "quiet";
  }

  if (
    curiousWords.some((word) =>
      normalized.includes(word),
    )
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

  const original =
    comment.comment.trim();

  if (!original) {
    return comment;
  }

  const tonePrefix: Record<
    Exclude<
      CompanionTone,
      "unknown"
    >,
    string
  > = {
    quiet: "我也觉得这里可以轻轻听，",
    excited: "这一下确实有点起来了，",
    sad: "这里听起来有点往心里沉，",
    warm: "这段有种慢慢靠近的感觉，",
    curious: "我也注意到这里了，",
  };

  const prefix =
    tonePrefix[tone];

  const shortened =
    original
      .replace(/^我觉得/, "")
      .replace(/^这里/, "")
      .replace(/^这段/, "")
      .trim();

  const nextComment =
    `${prefix}${shortened}`;

  return {
    ...comment,
    comment:
      nextComment.length > 42
        ? nextComment.slice(0, 42)
        : nextComment,
  };
}

function createStage9FallbackComments(): DemoComment[] {
  return [
    {
      id: "stage9-fallback-12",
      timeSeconds: 12,
      eventType: "intro",
      comment:
        "我先不分析太多，陪你听进去。",
    },
    {
      id: "stage9-fallback-30",
      timeSeconds: 30,
      eventType:
        "emotion_shift",
      comment:
        "这里的感觉好像慢慢展开了。",
    },
    {
      id: "stage9-fallback-52",
      timeSeconds: 52,
      eventType:
        "theme_return",
      comment:
        "这一段可以先顺着它的情绪走。",
    },
  ];
}

function createCompanionMessage(
  text: string,
  musicTimeSeconds: number,
  commentId: string,
): ListeningMessage {
  return {
    id: createMessageId(),
    sender: "companion",
    text,
    musicTimeSeconds,
    commentId,
  };
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
    companionTone,
    setCompanionTone,
  ] =
    useState<CompanionTone>(
      "unknown",
    );

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

  const companionComments =
    useMemo(() => {
      return activeComments.map(
        (comment) =>
          adaptCommentToTone(
            comment,
            companionTone,
          ),
      );
    }, [
      activeComments,
      companionTone,
    ]);

  const addCompanionMessage =
    useCallback(
      (
        text: string,
        commentId: string,
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
                    commentId,
              );

            if (alreadyExists) {
              return previousMessages;
            }

            return [
              ...previousMessages,
              createCompanionMessage(
                text,
                playback.currentTime,
                commentId,
              ),
            ];
          },
        );
      },
      [playback.currentTime],
    );

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
        companionComments,

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
      setCompanionTone(
        "unknown",
      );
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

          addCompanionMessage(
            "我差不多跟上这首歌了，后面我会少说一点，只在有感觉的时候冒出来。",
            STAGE9_ANALYSIS_READY_COMMENT_ID,
          );
        } catch (error) {
          console.error(
            "音频分析失败：",
            error,
          );

          const message =
            error instanceof Error
              ? error.message
              : "音频分析失败，请稍后重试。";

          setAnalysisStatus(
            "error",
          );

          setAnalysisError(
            message,
          );

          setAnalysisSummary(
            "AI暂时没能完成完整分析，但音乐可以继续播放。",
          );

          setActiveComments(
            createStage9FallbackComments(),
          );

          setListeningSessionId(
            (previous) =>
              previous + 1,
          );

          addCompanionMessage(
            "我这边暂时没法完整分析，但不影响我们先听，我会用轻一点的方式陪你。",
            STAGE9_FALLBACK_COMMENT_ID,
          );
        }
      },
      [addCompanionMessage],
    );

  const handleFileSelect = (
    file: File,
  ) => {
    setAudioFile(file);

    resetListeningSession();

    setListeningMessages([
      createCompanionMessage(
        "你先播放就行，我会边跟着听，慢慢抓这首歌的感觉。",
        0,
        STAGE9_WARMUP_COMMENT_ID,
      ),
    ]);

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

    addCompanionMessage(
      "我再试一次跟上这首歌，你不用停下来等我。",
      `${STAGE9_FALLBACK_COMMENT_ID}-retry-${Date.now()}`,
    );

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

      addCompanionMessage(
        "那我先用演示评论陪你听，主要测试共同聆听的感觉。",
        `${STAGE9_FALLBACK_COMMENT_ID}-demo`,
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

    const inferredTone =
      inferCompanionTone(
        cleanText,
      );

    if (
      inferredTone !==
      "unknown"
    ) {
      setCompanionTone(
        inferredTone,
      );

      const toneResponse: Record<
        Exclude<
          CompanionTone,
          "unknown"
        >,
        string
      > = {
        quiet:
          "嗯，那我后面也轻一点说，别打断这首歌的气氛。",
        excited:
          "懂了，后面我会更注意那些突然冲起来的地方。",
        sad:
          "我懂，你这个感受挺重要的，后面我会顺着这种情绪听。",
        warm:
          "嗯，这首歌的温度我也会多留意一点。",
        curious:
          "可以，我后面会帮你一起盯着这种变化。",
      };

      setListeningMessages(
        (
          previousMessages,
        ) => [
          ...previousMessages,
          createCompanionMessage(
            toneResponse[
              inferredTone
            ],
            playback.currentTime,
            `stage9-tone-${Date.now()}`,
          ),
        ],
      );
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
              ? "选择一首音乐，播放可以立即开始。AI会像朋友一样慢慢跟上。"
              : isWorking
                ? "你不用等我，先听就好。我正在后台跟上这首歌。"
                : analysisStatus ===
                    "success"
                  ? "我已经跟上了，后面只在有感觉的时候轻轻说两句。"
                  : analysisStatus ===
                      "error"
                    ? "分析暂时失败，但音乐不用停，我会用基础陪伴模式继续。"
                    : analysisStatus ===
                        "fallback"
                      ? "现在使用基础陪伴模式，先把共同聆听的感觉跑起来。"
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
          阶段9：先把预分析评论优化成共同聆听体验；真正实时聆听会在后续阶段继续推进。
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