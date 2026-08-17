"use client";

import type { ListeningMessage } from "@/types/music";

interface ListeningHistoryProps {
  messages: ListeningMessage[];
}

function formatMusicTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = totalSeconds % 60;

  return `${minutes}:${restSeconds.toString().padStart(2, "0")}`;
}

export default function ListeningHistory({
  messages,
}: ListeningHistoryProps) {
  return (
    <section
      className="listening-history-section glass-card"
      aria-label="一起听的记录"
    >
      <div className="history-heading">
        <div>
          <p className="history-eyebrow">LISTENING HISTORY</p>
          <h2 className="history-title">一起听的记录</h2>
        </div>

        <span className="history-count">
          {messages.length ? `${messages.length} 条` : "等待开始"}
        </span>
      </div>

      {messages.length === 0 ? (
        <div className="history-empty">
          播放音乐后，这里会显示 AI 的评论和你的语音转写。
        </div>
      ) : (
        <div className="listening-history">
          {messages.map((message) => {
            const isCompanion = message.sender === "companion";

            return (
              <article
                key={message.id}
                className={`history-message ${
                  isCompanion
                    ? "history-message-companion"
                    : "history-message-user"
                }`}
                aria-label={`${isCompanion ? "AI 回应" : "你说话"}，音乐时间 ${formatMusicTime(message.musicTimeSeconds)}`}
              >
                <div className="message-meta">
                  <span>{isCompanion ? "AI" : "你"}</span>
                  <time>{formatMusicTime(message.musicTimeSeconds)}</time>
                </div>

                <p className="message-text">{message.text}</p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
