"use client";

import type { ListeningMessage } from "@/types/music";
import {
  localizeRuntimeMessage,
  tr,
  type AppLanguage,
} from "@/lib/i18n";

interface ListeningHistoryProps {
  language: AppLanguage;
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
  language,
  messages,
}: ListeningHistoryProps) {
  return (
    <section
      className="listening-history-section glass-card"
      aria-label={tr(language, "一起听的记录", "Listening history")}
    >
      <div className="history-heading">
        <div>
          <p className="history-eyebrow">LISTENING HISTORY</p>
          <h2 className="history-title">
            {tr(language, "一起听的记录", "Listening history")}
          </h2>
        </div>

        <span className="history-count">
          {messages.length
            ? tr(language, `${messages.length} 条`, `${messages.length} items`)
            : tr(language, "等待开始", "Waiting to start")}
        </span>
      </div>

      {messages.length === 0 ? (
        <div className="history-empty">
          {tr(
            language,
            "播放音乐后，这里会显示 AI 的评论和你的语音转写。",
            "After playback starts, AI comments and transcripts of your voice will appear here.",
          )}
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
                aria-label={`${isCompanion ? tr(language, "AI 回应", "AI response") : tr(language, "你说话", "You spoke")}, ${tr(language, "音乐时间", "music time")} ${formatMusicTime(message.musicTimeSeconds)}`}
              >
                <div className="message-meta">
                  <span>
                    {isCompanion ? "AI" : tr(language, "你", "You")}
                  </span>
                  <time>{formatMusicTime(message.musicTimeSeconds)}</time>
                </div>

                <p className="message-text">
                  {localizeRuntimeMessage(message.text, language)}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
