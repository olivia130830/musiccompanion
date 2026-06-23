import {
  del,
  get,
} from "@vercel/blob";

import type {
  AudioAnalysisResult,
  DemoComment,
  TrackIdentity,
} from "@/types/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface AnalyzeAudioRequestBody {
  blobPathname?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
}

interface AudDResponse {
  status?: string;

  result?: {
    artist?: string;
    title?: string;
    album?: string;
    release_date?: string;
    label?: string;
    song_link?: string;
    spotify?: {
      external_urls?: {
        spotify?: string;
      };
    };
    apple_music?: {
      url?: string;
    };
  } | null;

  error?: {
    error_message?: string;
    error_code?: number;
  };
}

function getRequiredBlobToken(): string {
  const token =
    process.env.BLOB_READ_WRITE_TOKEN?.trim();

  if (!token) {
    throw new Error(
      "服务器没有读取到BLOB_READ_WRITE_TOKEN。请检查.env.local和Vercel环境变量。",
    );
  }

  return token;
}

function getString(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function getAudioMimeType(
  fileName: string,
  rawMimeType: string,
): string {
  if (rawMimeType) {
    return rawMimeType;
  }

  const extension =
    fileName
      .split(".")
      .pop()
      ?.toLowerCase() ?? "";

  if (extension === "wav") {
    return "audio/wav";
  }

  if (extension === "m4a") {
    return "audio/mp4";
  }

  if (extension === "aac") {
    return "audio/aac";
  }

  return "audio/mpeg";
}

async function readStreamToArrayBuffer(
  stream: ReadableStream<Uint8Array>,
): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const {
      value,
      done,
    } = await reader.read();

    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    chunks.push(value);
    totalLength += value.length;
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged.buffer.slice(0) as ArrayBuffer;
}

async function recognizeWithAudD({
  audioBlob,
  fileName,
}: {
  audioBlob: Blob;
  fileName: string;
}): Promise<TrackIdentity> {
  const token =
    process.env.AUDD_API_TOKEN?.trim();

  if (!token) {
    return {
      title: null,
      artist: null,
      album: null,
      source: "none",
      confidenceText:
        "未配置AUDD_API_TOKEN，所以没有进行歌名识别。",
    };
  }

  const formData = new FormData();

  formData.append("api_token", token);
  formData.append("file", audioBlob, fileName);
  formData.append("return", "apple_music,spotify");

  const response = await fetch(
    "https://api.audd.io/",
    {
      method: "POST",
      body: formData,
    },
  );

  if (!response.ok) {
    throw new Error(
      `AudD识别失败：HTTP ${response.status}`,
    );
  }

  const data =
    (await response.json()) as AudDResponse;

  if (data.status !== "success") {
    const message =
      data.error?.error_message ||
      "AudD没有返回成功状态。";

    throw new Error(
      `AudD识别失败：${message}`,
    );
  }

  if (!data.result) {
    return {
      title: null,
      artist: null,
      album: null,
      source: "none",
      confidenceText:
        "AudD没有识别出明确歌名。可能是音频片段太短、噪声较多、倒放、变调，或歌曲不在数据库中。",
    };
  }

  return {
    title: data.result.title ?? null,
    artist: data.result.artist ?? null,
    album: data.result.album ?? null,
    source: "audd",
    confidenceText:
      "AudD返回了歌曲识别结果，适合表达为“识别结果”，不要说100%确定。",
  };
}

function createCommentsFromIdentity(
  identity: TrackIdentity,
): DemoComment[] {
  const firstComment =
    identity.title || identity.artist
      ? `识别结果像是 ${identity.title ?? "未知歌名"}${
          identity.artist
            ? ` - ${identity.artist}`
            : ""
        }。`
      : "暂时没有识别出准确歌名。";

  return [
    {
      id: "audd-identity-0",
      timeSeconds: 3,
      eventType: "intro",
      comment: firstComment,
    },
    {
      id: "audd-identity-1",
      timeSeconds: 18,
      eventType: "emotion_shift",
      comment:
        "歌名识别只是身份信息，具体听感还要结合本地音频特征。",
    },
    {
      id: "audd-identity-2",
      timeSeconds: 36,
      eventType: "theme_return",
      comment:
        "如果识别不到歌名，可能是片段太短、倒放、变调或数据库未收录。",
    },
  ];
}

function buildSummary(
  identity: TrackIdentity,
): string {
  const parts: string[] = [];

  if (identity.title || identity.artist) {
    parts.push(
      `歌曲识别：${identity.title ?? "未知歌名"}${
        identity.artist
          ? ` - ${identity.artist}`
          : ""
      }。`,
    );
  } else {
    parts.push(
      "歌曲识别：暂时没有识别出准确歌名。",
    );
  }

  if (identity.album) {
    parts.push(`专辑：${identity.album}。`);
  }

  parts.push(`识别说明：${identity.confidenceText}`);

  return parts.join("\n");
}

export async function POST(request: Request) {
  const blobToken = getRequiredBlobToken();
  let blobPathname = "";

  try {
    const body =
      (await request.json()) as AnalyzeAudioRequestBody;

    blobPathname = getString(body.blobPathname);

    const fileName =
      getString(body.fileName) || "audio.mp3";

    const mimeType = getAudioMimeType(
      fileName,
      getString(body.mimeType),
    );

    if (!blobPathname) {
      return Response.json(
        {
          error: "缺少blobPathname。",
        },
        {
          status: 400,
        },
      );
    }

    const privateBlob = await get(blobPathname, {
      access: "private",
      token: blobToken,
    });

    if (!privateBlob || !privateBlob.stream) {
      throw new Error(
        "没有读取到私有音频stream。",
      );
    }

    const arrayBuffer =
      await readStreamToArrayBuffer(
        privateBlob.stream,
      );

    const audioBytes =
      new Uint8Array(arrayBuffer);

    const audioBlob = new Blob([audioBytes], {
      type: mimeType,
    });

    const identity = await recognizeWithAudD({
      audioBlob,
      fileName,
    });

    const result: AudioAnalysisResult = {
      summary: buildSummary(identity),
      comments: createCommentsFromIdentity(identity),
      model: "AudD",
      trackIdentity: identity,
    };

    return Response.json(result);
  } catch (error) {
    console.error(
      "[AudD Analysis] 失败：",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "AudD音乐识别失败。";

    return Response.json(
      {
        error: message,
      },
      {
        status: 500,
      },
    );
  } finally {
    if (blobPathname) {
      try {
        await del(blobPathname, {
          token: blobToken,
        });

        console.log(
          "[AudD Analysis] 已删除私有临时音频：",
          blobPathname,
        );
      } catch (error) {
        console.warn(
          "[AudD Analysis] 删除私有临时音频失败：",
          error,
        );
      }
    }
  }
}