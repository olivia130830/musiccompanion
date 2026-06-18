"use client";

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
  if (!hasAudio) {
    return null;
  }

  if (!comment) {
    return (
      <section
        className="current-comment-waiting"
        aria-live="polite"
      >
        <span className="current-comment-label">
          共同聆听者
        </span>

        <p className="current-comment-waiting-text">
          先听一会儿，它会在合适的时候说话。
        </p>
      </section>
    );
  }

  return (
    <section
      className="
        current-comment-card
        current-comment-enter
      "
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="current-comment-meta">
        <span className="current-comment-label">
          共同聆听者
        </span>

        <time className="current-comment-time">
          {formatTime(
            comment.timeSeconds,
          )}
        </time>
      </div>

      <p className="current-comment-text">
        {comment.comment}
      </p>
    </section>
  );
}