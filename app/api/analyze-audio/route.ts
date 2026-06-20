import {
  del,
  get,
} from "@vercel/blob";

import { NextResponse } from "next/server";

import {
  analyzeAudioWithGemini,
} from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_AUDIO_SIZE_BYTES =
  100 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
]);

interface AnalyzeAudioRequest {
  blobPathname?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
}

function cleanFileName(
  value: string,
): string {
  return (
    value
      .replace(
        /[^\p{L}\p{N}._ -]/gu,
        "",
      )
      .trim()
      .slice(0, 120) || "audio"
  );
}

function isAllowedPathname(
  value: string,
): boolean {
  return (
    value.startsWith(
      "music-analysis/",
    ) &&
    !value.includes("..")
  );
}

function describeRouteError(
  error: unknown,
): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const details = [error.message];

  const errorWithCause = error as Error & {
    cause?: unknown;
  };

  if (
    errorWithCause.cause instanceof Error
  ) {
    details.push(
      errorWithCause.cause.message,
    );
  }

  return [...new Set(details)]
    .filter(Boolean)
    .join("；");
}

function createUserFacingError(
  error: unknown,
): string {
  const details =
    describeRouteError(error);

  const lower =
    details.toLowerCase();

  if (
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes(
      "connect timeout",
    )
  ) {
    return [
      "服务器连接Gemini失败。",
      "音频已经成功上传和读取，",
      "但当前Node.js进程无法稳定访问Gemini API。",
      `详细原因：${details}`,
    ].join("");
  }

  if (
    lower.includes(
      "permission_denied",
    ) ||
    lower.includes("403")
  ) {
    return [
      "Gemini拒绝了当前API Key。",
      "请检查Key权限、可用地区及项目配置。",
      `详细原因：${details}`,
    ].join("");
  }

  if (
    lower.includes(
      "failed_precondition",
    )
  ) {
    return [
      "当前地区或项目配置暂时无法使用Gemini API免费层。",
      "请检查Google AI Studio中的项目状态。",
      `详细原因：${details}`,
    ].join("");
  }

  if (
    lower.includes("429") ||
    lower.includes(
      "resource_exhausted",
    )
  ) {
    return "Gemini请求次数达到限制，请稍后重新分析。";
  }

  return details;
}

export async function POST(
  request: Request,
): Promise<NextResponse> {
  const token =
    process.env
      .BLOB_READ_WRITE_TOKEN
      ?.trim();

  if (!token) {
    return NextResponse.json(
      {
        error:
          "服务器尚未配置BLOB_READ_WRITE_TOKEN。",
      },
      {
        status: 500,
      },
    );
  }

  let body: AnalyzeAudioRequest;

  try {
    body =
      (await request.json()) as AnalyzeAudioRequest;
  } catch {
    return NextResponse.json(
      {
        error:
          "音频分析请求格式无效。",
      },
      {
        status: 400,
      },
    );
  }

  if (
    typeof body.blobPathname !==
      "string" ||
    !isAllowedPathname(
      body.blobPathname,
    )
  ) {
    return NextResponse.json(
      {
        error:
          "私有音频文件路径无效。",
      },
      {
        status: 400,
      },
    );
  }

  if (
    typeof body.mimeType !==
      "string" ||
    !ALLOWED_MIME_TYPES.has(
      body.mimeType,
    )
  ) {
    return NextResponse.json(
      {
        error:
          "不支持这种音频格式。",
      },
      {
        status: 400,
      },
    );
  }

  const blobPathname =
    body.blobPathname;

  const fileName =
    typeof body.fileName ===
    "string"
      ? cleanFileName(
          body.fileName,
        )
      : "audio";

  try {
    /**
     * Private Blob必须在服务端使用认证读取。
     */
    const privateBlob =
      await get(
        blobPathname,
        {
          access: "private",
          token,
        },
      );

    if (
      !privateBlob ||
      privateBlob.statusCode !==
        200 ||
      !privateBlob.stream
    ) {
      throw new Error(
        "服务器无法读取私有音频文件。",
      );
    }

    const declaredSize =
      privateBlob.blob.size;

    if (
      Number.isFinite(
        declaredSize,
      ) &&
      declaredSize >
        MAX_AUDIO_SIZE_BYTES
    ) {
      throw new Error(
        "音频文件不能超过100MB。",
      );
    }

    const arrayBuffer =
      await new Response(
        privateBlob.stream,
      ).arrayBuffer();

    if (
      arrayBuffer.byteLength >
      MAX_AUDIO_SIZE_BYTES
    ) {
      throw new Error(
        "音频文件不能超过100MB。",
      );
    }

    const resolvedMimeType =
      privateBlob.blob
        .contentType ||
      body.mimeType;

    if (
      !ALLOWED_MIME_TYPES.has(
        resolvedMimeType,
      )
    ) {
      throw new Error(
        "私有文件的音频格式不受支持。",
      );
    }

    const audioBlob =
      new Blob(
        [arrayBuffer],
        {
          type: resolvedMimeType,
        },
      );

    const result =
      await analyzeAudioWithGemini({
        audioBlob,
        fileName,
        mimeType:
          resolvedMimeType,
      });

    return NextResponse.json(
      result,
    );
  } catch (error) {
    const message =
      createUserFacingError(
        error,
      );

    console.error(
      "[Audio Analysis] 失败：",
      error,
    );

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
      },
    );
  } finally {
    try {
      await del(
        blobPathname,
        {
          token,
        },
      );

      console.info(
        "[Audio Analysis] 已删除私有临时音频：",
        blobPathname,
      );
    } catch (error) {
      console.error(
        "[Audio Analysis] 删除临时音频失败：",
        error,
      );
    }
  }
}