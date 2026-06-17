"use client";

import {
  useEffect,
  useRef,
} from "react";

import CommentFeedback from "@/components/CommentFeedback";

import type {
  CommentFeedback as CommentFeedbackValue,
  ListeningMessage,
} from "@/types/music";

import { formatTime } from "@/utils/formatTime";

interface ListeningHistoryProps {
  messages: ListeningMessage[];

  feedbackByCommentId: Record<
    string,
    CommentFeedbackValue
  >;

  onFeedbackChange: (
    commentId: string,
    feedback: CommentFeedbackValue,
  ) => void;
}

export default function ListeningHistory({
  messages,
  feedbackByCommentId,
  onFeedbackChange,
}: ListeningHistoryProps) {
  const historyRef =
    useRef<HTMLDivElement | null>(null);

  /**
   * 新消息出现时，让历史区域滚到底部，
   * 但只滚动内部容器，不强制整个页面跳动。
   */
  useEffect(() => {
    const history = historyRef.current;

    if (!history || messages.length === 0) {
      return;
    }

    history.scrollTo({
      top: history.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  return (
    <section
      className="listening-history-section"
      aria-labelledby="listening-history-title"
    >
      <div className="history-heading">
        <div>
          <p className="history-eyebrow">
            共同经历
          </p>

          <h2
            id="listening-history-title"
            className="history-title"
          >
            共同聆听记录
          </h2>
        </div>

        <span className="history-count">
          {messages.length} 条
        </span>
      </div>

      <div
        ref={historyRef}
        className="listening-history"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="history-empty">
            还没有留下记录。音乐播放到合适的
            时刻后，伙伴的感受会出现在这里。
          </p>
        ) : (
          messages.map((message) => {
            const isCompanion =
              message.sender === "companion";

            return (
              <article
                key={message.id}
                className={`history-message ${
                  isCompanion
                    ? "history-message-companion"
                    : "history-message-user"
                }`}
              >
                <div className="message-meta">
                  <span>
                    {isCompanion
                      ? "共同聆听者"
                      : "你"}
                  </span>

                  <time>
                    {formatTime(
                      message.musicTimeSeconds,
                    )}
                  </time>
                </div>

                <p className="message-text">
                  {message.text}
                </p>

                {isCompanion && (
                  <CommentFeedback
                    value={
                      feedbackByCommentId[
                        message.commentId
                      ]
                    }
                    onChange={(feedback) =>
                      onFeedbackChange(
                        message.commentId,
                        feedback,
                      )
                    }
                  />
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}