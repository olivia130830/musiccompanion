"use client";

import type { CSSProperties } from "react";
import type { DemoComment } from "@/types/music";
import { formatTime } from "@/utils/formatTime";

interface CurrentCommentProps {
  comment: DemoComment | null;
  hasAudio: boolean;
}

export default function CurrentComment({
  comment,
  hasAudio,
}: CurrentCommentProps) {
  /**
   * 没选择音乐时，不显示评论区域。
   */
  if (!hasAudio) {
    return null;
  }

  /**
   * 音乐已加载，但还没有到达评论时间点。
   */
  if (!comment) {
    return (
      <section style={styles.waiting} aria-live="polite">
        <span style={styles.label}>共同聆听者</span>

        <p style={styles.waitingText}>
          先听一会儿，它会在合适的时候说话。
        </p>
      </section>
    );
  }

  return (
    <section
      className="current-comment-enter"
      style={styles.card}
      aria-live="polite"
      aria-atomic="true"
    >
      <div style={styles.meta}>
        <span style={styles.label}>共同聆听者</span>

        <time style={styles.time}>
          {formatTime(comment.timeSeconds)}
        </time>
      </div>

      <p style={styles.comment}>
        {comment.comment}
      </p>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  waiting: {
    width: "100%",
    maxWidth: "420px",
    minHeight: "98px",
    padding: "20px",
    border: "1px dashed var(--border)",
    borderRadius: "16px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "8px",
  },

  waitingText: {
    margin: 0,
    color: "var(--text-secondary)",
    fontSize: "14px",
    lineHeight: 1.7,
  },

  card: {
    width: "100%",
    maxWidth: "420px",
    minHeight: "98px",
    padding: "20px",
    border: "1px solid var(--border-light)",
    borderRadius: "16px",
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.07), rgba(255,255,255,0.025))",
    boxShadow: "0 14px 34px rgba(0,0,0,0.22)",
  },

  meta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "10px",
  },

  label: {
    color: "var(--text-secondary)",
    fontSize: "12px",
    letterSpacing: "0.08em",
  },

  time: {
    color: "var(--text-secondary)",
    fontSize: "12px",
  },

  comment: {
    margin: 0,
    color: "var(--text-primary)",
    fontSize: "16px",
    lineHeight: 1.75,
  },
};