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

import type {
  CommentFeedback,
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

export default function Home() {
  const [audioFile, setAudioFile] =
    useState<File | null>(null);

  const [playback, setPlayback] =
    useState<PlaybackSnapshot>(
      INITIAL_PLAYBACK,
    );

  const [
    listeningMessages,
    setListeningMessages,
  ] = useState<ListeningMessage[]>([]);

  const [
    feedbackByCommentId,
    setFeedbackByCommentId,
  ] = useState<
    Record<string, CommentFeedback>
  >({});

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

  const handleCommentTriggered =
    useCallback((comment: DemoComment) => {
      setListeningMessages(
        (previousMessages) => {
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
              sender: "companion",
              text: comment.comment,
              musicTimeSeconds:
                comment.timeSeconds,
              commentId: comment.id,
            };

          return [
            ...previousMessages,
            newMessage,
          ];
        },
      );
    }, []);

  const { currentComment } =
    useCommentScheduler({
      comments: demoComments,
      currentTime: playback.currentTime,
      isPlaying: playback.isPlaying,
      isSeeking: playback.isSeeking,
      trackKey,
      onCommentTriggered:
        handleCommentTriggered,
    });

  const handleFileSelect = (file: File) => {
    setAudioFile(file);
    setPlayback(INITIAL_PLAYBACK);
    setListeningMessages([]);
    setFeedbackByCommentId({});
  };

  const handleFeedbackChange = (
    commentId: string,
    feedback: CommentFeedback,
  ) => {
    setFeedbackByCommentId(
      (previousFeedback) => ({
        ...previousFeedback,
        [commentId]: feedback,
      }),
    );
  };

  const handleUserSend = (text: string) => {
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
      musicTimeSeconds:
        playback.currentTime,
    };

    setListeningMessages(
      (previousMessages) => [
        ...previousMessages,
        newMessage,
      ],
    );
  };

  return (
    <main className="app-shell">
      <div
        className="background-orb background-orb-blue"
        aria-hidden="true"
      />

      <div
        className="background-orb background-orb-purple"
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

          <h1 style={styles.title}>
            有人和你一起听
          </h1>

          <p style={styles.subtitle}>
            音乐发生的时候，也有人听见。
          </p>
        </header>

        <section style={styles.heroCard}>
          <p style={styles.description}>
            {!audioFile
              ? "选择一首音乐，开始一次共同聆听。"
              : "正在共同聆听，它会在合适的时候分享感受。"}
          </p>

          <AudioUploader
            onFileSelect={handleFileSelect}
          />
        </section>

        <MusicPlayer
          audioFile={audioFile}
          onPlaybackStateChange={
            setPlayback
          }
        />

        <CurrentComment
          key={`current-comment-${
            currentComment?.id ?? trackKey
          }`}
          comment={currentComment}
          hasAudio={Boolean(audioFile)}
        />

        <ListeningHistory
          messages={listeningMessages}
          feedbackByCommentId={
            feedbackByCommentId
          }
          onFeedbackChange={
            handleFeedbackChange
          }
        />

        <UserReplyBox
          key={`reply-box-${trackKey}`}
          disabled={!audioFile}
          onSend={handleUserSend}
        />

        <footer style={styles.footer}>
          音频只在你的浏览器中播放，不会上传。
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
    background:
      "rgba(255, 255, 255, 0.68)",
    boxShadow:
      "0 8px 28px rgba(54, 89, 142, 0.08)",
    backdropFilter: "blur(16px)",
    color: "var(--text-secondary)",
    fontSize: "12px",
    fontWeight: 650,
    letterSpacing: "0.04em",
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
    margin: "0 0 12px",
    color: "var(--text-primary)",
    fontSize: "clamp(34px, 7vw, 52px)",
    fontWeight: 670,
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
    border:
      "1px solid rgba(116, 139, 181, 0.16)",
    borderRadius: "24px",
    background:
      "rgba(255, 255, 255, 0.64)",
    boxShadow:
      "0 18px 60px rgba(74, 107, 163, 0.1)",
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

  footer: {
    padding: "8px 0 18px",
    color: "var(--text-tertiary)",
    fontSize: "11px",
    textAlign: "center",
  },
};