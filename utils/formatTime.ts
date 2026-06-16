/**
 * 将秒数转换为 "分:秒" 格式
 * 例如：125 秒 → "2:05"
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  // 确保秒数总是两位
  const paddedSecs = String(secs).padStart(2, "0");

  return `${minutes}:${paddedSecs}`;
}
