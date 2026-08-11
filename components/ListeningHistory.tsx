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

const WAVE_HEIGHTS = [8, 15, 22, 12, 25, 18, 10, 20, 14, 7];

export default function ListeningHistory({
  messages,
}: ListeningHistoryProps) {
  return (
    <section className="voice-turns" aria-label="语音陪听轮次">
      <div className="voice-turns-header">
        <div>
          <p className="voice-turns-eyebrow">VOICE COMPANION</p>
          <h2 className="voice-turns-title">正在一起听</h2>
        </div>

        <span className="voice-turns-count">
          {messages.length ? `${messages.length} 次对话` : "等待开始"}
        </span>
      </div>

      {messages.length === 0 ? (
        <div className="voice-turns-empty">
          <span className="voice-turns-empty-orb" aria-hidden="true" />
          <p>播放音乐后，AI 会听见变化并自然回应。</p>
        </div>
      ) : (
        <div className="voice-turns-list">
          {messages.map((message) => {
            const isCompanion = message.sender === "companion";

            return (
              <article
                key={message.id}
                className={`voice-turn ${
                  isCompanion ? "voice-turn-ai" : "voice-turn-user"
                }`}
                aria-label={`${isCompanion ? "AI 回应" : "你说话"}，音乐时间 ${formatMusicTime(message.musicTimeSeconds)}`}
              >
                <span className="voice-turn-avatar" aria-hidden="true">
                  {isCompanion ? "AI" : "你"}
                </span>

                <div className="voice-turn-body">
                  <div className="voice-turn-meta">
                    <span>{isCompanion ? "AI 回应了一句" : "你说了一句"}</span>
                    <time>{formatMusicTime(message.musicTimeSeconds)}</time>
                  </div>

                  <div className="voice-turn-wave" aria-hidden="true">
                    {WAVE_HEIGHTS.map((height, index) => (
                      <span
                        key={`${message.id}-wave-${index}`}
                        style={{ height }}
                      />
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
