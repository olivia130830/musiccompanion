import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_SIZE_BYTES =
  100 * 1024 * 1024;

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
];

interface ErrorResponse {
  error: string;
}

/**
 * 为浏览器生成Vercel Blob客户端直传凭证。
 *
 * 用户在页面点击“选择音乐”并选择文件后：
 *
 * 1. 浏览器请求这个接口获取短期上传凭证；
 * 2. 浏览器把音频直接上传到Private Blob；
 * 3. 上传完成后，页面调用音频分析接口；
 * 4. 服务端读取Private Blob并交给Gemini分析。
 */
export async function POST(
  request: Request,
): Promise<NextResponse> {
  const blobToken =
    process.env.BLOB_READ_WRITE_TOKEN?.trim();

  if (!blobToken) {
    console.error(
      "[Blob Upload] 未读取到BLOB_READ_WRITE_TOKEN。",
    );

    return NextResponse.json<ErrorResponse>(
      {
        error:
          "服务器没有读取到BLOB_READ_WRITE_TOKEN。请检查.env文件并重新启动开发服务器。",
      },
      {
        status: 500,
      },
    );
  }

  let body: HandleUploadBody;

  try {
    body =
      (await request.json()) as HandleUploadBody;
  } catch (error) {
    console.error(
      "[Blob Upload] 无法解析上传凭证请求：",
      error,
    );

    return NextResponse.json<ErrorResponse>(
      {
        error: "Blob上传凭证请求格式无效。",
      },
      {
        status: 400,
      },
    );
  }

  try {
    const jsonResponse =
      await handleUpload({
        request,
        body,

        /**
         * 显式使用当前Private Blob Store的Token。
         * 该Token只存在于服务端，不会暴露给浏览器。
         */
        token: blobToken,

        onBeforeGenerateToken:
          async (pathname) => {
            if (
              !pathname.startsWith(
                "music-analysis/",
              )
            ) {
              throw new Error(
                "不允许上传到该存储路径。",
              );
            }

            return {
              allowedContentTypes:
                ALLOWED_AUDIO_TYPES,

              maximumSizeInBytes:
                MAX_AUDIO_SIZE_BYTES,

              addRandomSuffix: true,

              /**
               * 只保存少量非敏感用途信息。
               */
              tokenPayload:
                JSON.stringify({
                  purpose:
                    "music-analysis",
                }),

              /**
               * 不配置callbackUrl。
               *
               * 当前项目不需要上传完成Webhook，
               * 浏览器上传完成后会主动请求分析接口。
               */
            };
          },

        /**
         * 不要添加onUploadCompleted。
         *
         * 本地localhost无法被Vercel服务器回调，
         * 这可能导致客户端上传Token生成失败。
         */
      });

    return NextResponse.json(
      jsonResponse,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "生成Blob上传凭证失败。";

    console.error(
      "[Blob Upload] 生成上传凭证失败：",
      error,
    );

    return NextResponse.json<ErrorResponse>(
      {
        error: message,
      },
      {
        status: 400,
      },
    );
  }
}