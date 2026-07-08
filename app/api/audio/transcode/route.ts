import {
  isSupportedAudioFile,
} from "@/lib/audio/formats";
import {
  MAX_TRANSCODE_SIZE_BYTES,
  TRANSCODED_AUDIO_FILE_NAME,
  TRANSCODED_AUDIO_MIME_TYPE,
  transcodeAudioToWav,
} from "@/lib/audio/transcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return Response.json(
      {
        error: "没有收到音频文件。",
      },
      {
        status: 400,
      },
    );
  }

  if (!isSupportedAudioFile(file)) {
    return Response.json(
      {
        error: "暂不支持这个音频格式。",
      },
      {
        status: 400,
      },
    );
  }

  if (file.size > MAX_TRANSCODE_SIZE_BYTES) {
    return Response.json(
      {
        error: "音频文件超过 100MB，暂时无法转码。",
      },
      {
        status: 413,
      },
    );
  }

  try {
    const outputBuffer =
      await transcodeAudioToWav(file);

    return new Response(outputBuffer, {
      status: 200,
      headers: {
        "content-type": TRANSCODED_AUDIO_MIME_TYPE,
        "content-disposition": `inline; filename="${TRANSCODED_AUDIO_FILE_NAME}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "音频转码失败。";

    console.error(
      "[Audio Transcode] 转码失败：",
      error,
    );

    return Response.json(
      {
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}
