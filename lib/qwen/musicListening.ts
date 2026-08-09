export const MUSIC_LISTENING_WINDOW_SECONDS = 16;

export function getRecentMusicSegment(
  currentTimeSeconds: number,
) {
  const currentTime = Math.max(0, currentTimeSeconds);
  const durationSeconds = Math.min(
    MUSIC_LISTENING_WINDOW_SECONDS,
    Math.max(0.5, currentTime),
  );

  return {
    startTimeSeconds: Math.max(0, currentTime - durationSeconds),
    durationSeconds,
  };
}
