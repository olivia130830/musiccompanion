export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PlaybackDebugBody {
  fileName?: unknown;
  currentTime?: unknown;
  duration?: unknown;
  isPlaying?: unknown;
}

function formatDebugTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = totalSeconds % 60;

  return `${minutes}:${restSeconds.toString().padStart(2, "0")}`;
}

export async function POST(request: Request) {
  const body = (await request.json()) as PlaybackDebugBody;

  const fileName =
    typeof body.fileName === "string" && body.fileName.trim()
      ? body.fileName.trim()
      : "未知音乐";

  const currentTime =
    typeof body.currentTime === "number" &&
    Number.isFinite(body.currentTime)
      ? body.currentTime
      : 0;

  const duration =
    typeof body.duration === "number" && Number.isFinite(body.duration)
      ? body.duration
      : 0;

  const isPlaying = body.isPlaying === true;

  console.log(
    `[播放时间] ${fileName} | ${formatDebugTime(currentTime)} / ${formatDebugTime(
      duration,
    )} | ${currentTime.toFixed(2)}s | ${isPlaying ? "播放中" : "未播放"}`,
  );

  return Response.json({
    ok: true,
  });
}