import {
  createPartFromUri,
  createUserContent,
  GoogleGenAI,
  Type,
} from "@google/genai";

import type { AudioAnalysisResult } from "@/types/music";

import { validateAnalysisResult } from "@/lib/validateAnalysis";

const DEFAULT_GEMINI_MODEL =
  "gemini-3.5-flash";

const FILE_PROCESSING_TIMEOUT_MS =
  3 * 60 * 1000;

const FILE_PROCESSING_INTERVAL_MS =
  1500;

const MAX_NETWORK_ATTEMPTS = 3;

const NETWORK_RETRY_DELAYS_MS = [
  1500,
  3500,
];

const ANALYSIS_PROMPT = `
你是一位正在与用户共同听音乐的AI伙伴。

请完整聆听这段音频，并生成可以在音乐播放过程中出现的简短评论。

你的目标不是写一篇音乐分析报告，而是在音乐真正发生的时刻，说出自然、简短、像共同聆听伙伴一样的感受。

要求：

1. 生成5到8条评论。
2. 每条评论必须对应一个准确的timeSeconds。
3. 第一条评论不要早于5秒。
4. 评论时间必须从小到大排列。
5. 相邻评论尽量间隔至少8秒。
6. 评论可以关注：
   - 音乐开始与进入
   - 情绪变化
   - 节奏或密度变化
   - 明显停顿
   - 主题或旋律再次出现
7. 每条评论尽量控制在15到35个中文字符。
8. 语气自然、温和、即时。
9. 不要写成老师讲课或长篇总结。
10. 不要使用过多专业术语。
11. 不要声称听到了无法确定的乐器、调性、作曲家或作品名称。
12. 不要生成超过音频结束时间的评论。
13. summary使用一到两句话概括这首音乐的整体聆听感受。

eventType只能使用以下五种值：

intro
emotion_shift
rhythm_entry
pause
theme_return
`;

const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,

  properties: {
    summary: {
      type: Type.STRING,
      description:
        "使用一到两句话写成的中文整体聆听感受。",
    },

    comments: {
      type: Type.ARRAY,
      description:
        "按照时间从小到大排列的即时音乐评论。",

      items: {
        type: Type.OBJECT,

        properties: {
          timeSeconds: {
            type: Type.NUMBER,
            description:
              "评论出现的音频时间，单位为秒。",
          },

          eventType: {
            type: Type.STRING,

            enum: [
              "intro",
              "emotion_shift",
              "rhythm_entry",
              "pause",
              "theme_return",
            ],

            description:
              "这一条评论对应的音乐事件类型。",
          },

          comment: {
            type: Type.STRING,
            description:
              "简短、自然的中文即时音乐评论。",
          },
        },

        required: [
          "timeSeconds",
          "eventType",
          "comment",
        ],
      },
    },
  },

  required: ["summary", "comments"],
};

interface AnalyzeAudioWithGeminiOptions {
  audioBlob: Blob;
  fileName: string;
  mimeType: string;
}

interface GeminiUploadedFile {
  name?: string;
  uri?: string;
  mimeType?: string;
  state?: string;
}

function sleep(
  milliseconds: number,
): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * 从嵌套错误中提取尽可能完整的信息。
 *
 * Node.js的fetch错误通常把真正原因放在cause里，
 * 例如ECONNRESET、ETIMEDOUT或连接超时。
 */
function describeError(
  error: unknown,
): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [error.message];

  const errorWithCause = error as Error & {
    cause?: unknown;
    code?: unknown;
    status?: unknown;
  };

  if (
    typeof errorWithCause.code ===
    "string"
  ) {
    parts.push(
      `code=${errorWithCause.code}`,
    );
  }

  if (
    typeof errorWithCause.status ===
    "number"
  ) {
    parts.push(
      `status=${errorWithCause.status}`,
    );
  }

  const cause =
    errorWithCause.cause;

  if (cause instanceof Error) {
    parts.push(
      `cause=${describeError(cause)}`,
    );
  } else if (
    cause &&
    typeof cause === "object"
  ) {
    const causeRecord =
      cause as Record<string, unknown>;

    const causeMessage =
      typeof causeRecord.message ===
      "string"
        ? causeRecord.message
        : "";

    const causeCode =
      typeof causeRecord.code ===
      "string"
        ? causeRecord.code
        : "";

    if (causeMessage) {
      parts.push(
        `cause=${causeMessage}`,
      );
    }

    if (causeCode) {
      parts.push(
        `causeCode=${causeCode}`,
      );
    }
  }

  return [...new Set(parts)]
    .filter(Boolean)
    .join("；");
}

function isRetryableError(
  error: unknown,
): boolean {
  const message =
    describeError(error).toLowerCase();

  return [
    "fetch failed",
    "econnreset",
    "econnrefused",
    "etimedout",
    "connect timeout",
    "connection timeout",
    "socket hang up",
    "und_err_connect_timeout",
    "network",
    "429",
    "500",
    "502",
    "503",
    "504",
    "resource_exhausted",
    "unavailable",
    "deadline_exceeded",
  ].some((keyword) =>
    message.includes(keyword),
  );
}

async function runWithRetry<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= MAX_NETWORK_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const shouldRetry =
        attempt <
          MAX_NETWORK_ATTEMPTS &&
        isRetryableError(error);

      console.error(
        `[Gemini] ${label}失败，第${attempt}次：`,
        describeError(error),
      );

      if (!shouldRetry) {
        break;
      }

      const delay =
        NETWORK_RETRY_DELAYS_MS[
          attempt - 1
        ] ?? 3500;

      await sleep(delay);
    }
  }

  throw new Error(
    `${label}失败：${describeError(
      lastError,
    )}`,
  );
}

/**
 * 等待Gemini把上传文件处理为ACTIVE。
 */
async function waitForFileToBecomeActive(
  ai: GoogleGenAI,
  initialFile: GeminiUploadedFile,
): Promise<GeminiUploadedFile> {
  if (!initialFile.name) {
    throw new Error(
      "Gemini没有返回有效的文件名称。",
    );
  }

  let currentFile =
    initialFile;

  const startedAt =
    Date.now();

  while (true) {
    const state =
      currentFile.state?.toUpperCase();

    if (
      state === "ACTIVE" ||
      (!state && currentFile.uri)
    ) {
      return currentFile;
    }

    if (state === "FAILED") {
      throw new Error(
        "Gemini处理音频文件失败。",
      );
    }

    if (
      Date.now() - startedAt >
      FILE_PROCESSING_TIMEOUT_MS
    ) {
      throw new Error(
        "Gemini处理音频超时，请稍后重试。",
      );
    }

    await sleep(
      FILE_PROCESSING_INTERVAL_MS,
    );

    currentFile =
      (await runWithRetry(
        "查询Gemini文件状态",
        async () =>
          ai.files.get({
            name: initialFile.name!,
          }),
      )) as GeminiUploadedFile;
  }
}

export async function analyzeAudioWithGemini({
  audioBlob,
  fileName,
  mimeType,
}: AnalyzeAudioWithGeminiOptions): Promise<AudioAnalysisResult> {
  const apiKey =
    process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "服务器尚未配置GEMINI_API_KEY。",
    );
  }

  const model =
    process.env.GEMINI_MODEL?.trim() ||
    DEFAULT_GEMINI_MODEL;

  const ai = new GoogleGenAI({
    apiKey,
  });

  /**
   * 第一阶段：把音频上传到Gemini Files API。
   */
  const uploadedFile =
    (await runWithRetry(
      "连接Gemini并上传音频",
      async () =>
        ai.files.upload({
          file: audioBlob,

          config: {
            mimeType,
            displayName: fileName,
          },
        }),
    )) as GeminiUploadedFile;

  try {
    const activeFile =
      await waitForFileToBecomeActive(
        ai,
        uploadedFile,
      );

    if (
      !activeFile.uri ||
      !activeFile.mimeType
    ) {
      throw new Error(
        "Gemini未返回有效的音频文件地址。",
      );
    }

    /**
     * 第二阶段：让模型分析音频。
     */
    const response =
      await runWithRetry(
        "请求Gemini分析音频",
        async () =>
          ai.models.generateContent({
            model,

            contents:
              createUserContent([
                createPartFromUri(
                  activeFile.uri!,
                  activeFile.mimeType!,
                ),

                ANALYSIS_PROMPT,
              ]),

            config: {
              responseMimeType:
                "application/json",

              responseSchema:
                ANALYSIS_SCHEMA,

              temperature: 0.65,
              maxOutputTokens: 4096,
            },
          }),
      );

    const responseText =
      response.text?.trim();

    if (!responseText) {
      throw new Error(
        "Gemini没有返回分析内容。",
      );
    }

    let parsedResult: unknown;

    try {
      parsedResult =
        JSON.parse(responseText);
    } catch {
      console.error(
        "[Gemini] 原始返回内容：",
        responseText,
      );

      throw new Error(
        "Gemini返回的内容不是有效JSON。",
      );
    }

    return validateAnalysisResult(
      parsedResult,
      model,
    );
  } finally {
    if (uploadedFile.name) {
      try {
        await ai.files.delete({
          name: uploadedFile.name,
        });
      } catch (error) {
        console.error(
          "[Gemini] 删除临时文件失败：",
          describeError(error),
        );
      }
    }
  }
}