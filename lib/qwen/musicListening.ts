// 只发送刚刚实际播放过的短窗口。较短的窗口既避免“提前听”，也能
// 减少浏览器转码、上传和模型首包等待时间。
export const MUSIC_LISTENING_WINDOW_SECONDS = 6;

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
