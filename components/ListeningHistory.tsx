"use client";

import type {
  CSSProperties,
} from "react";

import CommentFeedback from "@/components/CommentFeedback";

import type {
  CommentFeedback as CommentFeedbackValue,
  ListeningMessage,
} from "@/types/music";

interface ListeningHistoryProps {
  messages: ListeningMessage[];
  feedbackByCommentId: Record<string, CommentFeedbackValue>;
  onFeedbackChange: (
    commentId: string,
    feedback: CommentFeedbackValue,
  ) => void;
}

function formatMusicTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = totalSeconds % 60;

  return `${minutes}:${restSeconds.toString().padStart(2, "0")}`;
}

export default function ListeningHistory({
  messages,
  feedbackByCommentId,
  onFeedbackChange,
}: ListeningHistoryProps) {
  if (messages.length === 0) {
    return (
      <section style={styles.emptyContainer}>
        <p style={styles.emptyText}>
          播放音乐后，这里会出现陪听评论和你的回复。
        </p>
      </section>
    );
  }

  return (
    <section style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>一起听的记录</span>
        <span style={styles.headerCount}>
          {messages.length} 条
        </span>
      </div>

      <div style={styles.list}>
        {messages.map((message) => {
          const isCompanion =
            message.sender === "companion";

          const canFeedback =
            isCompanion &&
            typeof message.commentId === "string" &&
            message.commentId.length > 0;

          const commentId = canFeedback
            ? message.commentId
            : null;

          return (
            <article
              key={message.id}
              style={{
                ...styles.message,
                ...(isCompanion
                  ? styles.companionMessage
                  : styles.userMessage),
              }}
            >
              <div style={styles.messageTopLine}>
                <span style={styles.sender}>
                  {isCompanion ? "AI" : "你"}
                </span>

                <span style={styles.time}>
                  {formatMusicTime(
                    message.musicTimeSeconds,
                  )}
                </span>
              </div>

              <p style={styles.messageText}>
                {message.text}
              </p>

              {commentId && (
                <CommentFeedback
                  value={
                    feedbackByCommentId[commentId]
                  }
                  onChange={(feedback) => {
                    onFeedbackChange(
                      commentId,
                      feedback,
                    );
                  }}
                />
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    width: "100%",
    maxWidth: "520px",
    padding: "16px",
    border: "1px solid rgba(116, 139, 181, 0.16)",
    borderRadius: "22px",
    background: "rgba(255, 255, 255, 0.58)",
    boxShadow:
      "0 16px 48px rgba(74, 107, 163, 0.08)",
    backdropFilter: "blur(20px)",
  },

  emptyContainer: {
    width: "100%",
    maxWidth: "520px",
    padding: "18px 16px",
    border: "1px dashed rgba(116, 139, 181, 0.22)",
    borderRadius: "22px",
    background: "rgba(255, 255, 255, 0.38)",
    backdropFilter: "blur(18px)",
  },

  emptyText: {
    margin: 0,
    color: "var(--text-tertiary)",
    fontSize: "13px",
    lineHeight: 1.7,
    textAlign: "center",
  },

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "12px",
  },

  headerTitle: {
    color: "var(--text-primary)",
    fontSize: "13px",
    fontWeight: 500,
  },

  headerCount: {
    color: "var(--text-tertiary)",
    fontSize: "11px",
  },

  list: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },

  message: {
    padding: "12px 13px",
    borderRadius: "18px",
    border: "1px solid rgba(116, 139, 181, 0.14)",
  },

  companionMessage: {
    alignSelf: "flex-start",
    width: "88%",
    background:
      "linear-gradient(135deg, rgba(255, 255, 255, 0.82), rgba(244, 248, 255, 0.72))",
  },

  userMessage: {
    alignSelf: "flex-end",
    width: "88%",
    background:
      "linear-gradient(135deg, rgba(93, 140, 255, 0.12), rgba(164, 122, 255, 0.1))",
  },

  messageTopLine: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    marginBottom: "6px",
  },

  sender: {
    color: "var(--text-secondary)",
    fontSize: "11px",
    fontWeight: 500,
  },

  time: {
    color: "var(--text-tertiary)",
    fontSize: "10px",
  },

  messageText: {
    margin: 0,
    color: "var(--text-primary)",
    fontSize: "13px",
    lineHeight: 1.65,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
};