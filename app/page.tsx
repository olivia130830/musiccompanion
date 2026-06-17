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

/**
 * 生成当前会话中的消息ID。
 */
function createMessageId(): string {
  if (
    typeof crypto !== "undefined" &&
    "randomUUID" in crypto
  ) {
    return crypto.randomUUID();
  }

  return [
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2),
  ].join("-");
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

  /**
   * 使用文件名称、大小和修改时间区分歌曲。
   */
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

  /**
   * 评论第一次触发时加入共同聆听记录。
   */
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

  /**
   * 选择新音乐时清空上一首歌的会话。
   */
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
    <main style={styles.main}>
      <section style={styles.container}>
        <header style={styles.header}>
          <h1 style={styles.title}>
            有人和你一起听
          </h1>

          <p style={styles.subtitle}>
            音乐发生的时候，也有人听见。
          </p>
        </header>

        <p style={styles.description}>
          {!audioFile
            ? "选择一首音乐，开始一次共同聆听。"
            : "先听一会儿，它会在合适的时候说话。"}
        </p>

        <AudioUploader
          onFileSelect={handleFileSelect}
        />

        <MusicPlayer
          audioFile={audioFile}
          onPlaybackStateChange={
            setPlayback
          }
        />

        <CurrentComment
          key={`current-comment-${currentComment?.id ?? trackKey}`}
          comment={currentComment}
          hasAudio={Boolean(audioFile)}
        />

        <ListeningHistory
          messages={listeningMessages}
          feedbackByCommentId={feedbackByCommentId}
          onFeedbackChange={handleFeedbackChange}
        />

        <UserReplyBox
          key={trackKey}
          disabled={!audioFile}
          onSend={handleUserSend}
        />
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "48px 20px 80px",
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
  },

  container: {
    width: "100%",
    maxWidth: "560px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "28px",
  },

  header: {
    textAlign: "center",
  },

  title: {
    margin: "0 0 8px",
    fontSize: "30px",
    fontWeight: 650,
    letterSpacing: "-0.02em",
  },

  subtitle: {
    margin: 0,
    color: "var(--text-secondary)",
    fontSize: "14px",
  },

  description: {
    minHeight: "21px",
    margin: 0,
    color: "var(--text-secondary)",
    fontSize: "14px",
    textAlign: "center",
  },
};