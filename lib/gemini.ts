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
你是一位正在和用户一起听音乐的AI伙伴。

请完整聆听这段音频，并生成可以在播放过程中自然出现的短评论。

你的目标不是写音乐分析报告，也不是当老师讲课。
你的目标是像一个正在旁边一起听歌的人，在音乐真正发生的时候，轻轻说出一些即时感受。

整体风格：

- 像朋友一起听，不像课堂讲解。
- 语气自然、克制、温和。
- 评论要短，不要长篇解释。
- 可以有一点感受和陪伴感。
- 不要显得你已经提前知道整首歌。
- 不要说“接下来会”“后面将会”。
- 不要剧透后续音乐变化。
- 不要频繁提“分析”“结构”“段落”“织体”“和声”等专业词。
- 不要声称听到了无法确定的乐器、调性、作曲家或作品名称。

评论要求：

1. 生成5到8条评论。
2. 每条评论必须对应一个准确的timeSeconds。
3. 第一条评论不要早于5秒。
4. 评论时间必须从小到大排列。
5. 相邻评论尽量间隔至少8秒。
6. 每条评论尽量控制在10到28个中文字符。
7. 评论必须适合在音乐播放到那个时间点时出现。
8. 评论可以关注：
   - 音乐刚进入时的第一感觉
   - 情绪变暗、变亮、变紧或变松
   - 节奏、力度、密度的明显变化
   - 明显停顿或留白
   - 熟悉的感觉再次回来
9. 最多生成2条带问句的评论。
10. 不要使用感叹号刷情绪。
11. 不要生成超过音频结束时间的评论。
12. summary使用一到两句话概括整体聆听感受，但不要写成正式乐评。

更好的评论例子：

- 这里像是慢慢靠近了。
- 这一下情绪轻轻抬起来了。
- 我喜欢这里突然空出来的感觉。
- 这里比前面更有推动感。
- 这段可以先安静听一会儿。
- 刚才那一下还挺抓人的。
- 这里好像回到了熟悉的感觉。
- 你有没有觉得这里变轻了？

不好的评论例子：

- 此处运用了复杂的和声进行。
- 接下来音乐会进入高潮。
- 该段落体现了作曲家的创作意图。
- 这里的旋律线条与低音声部形成复调关系。
- 现在第一个主题再次出现并发展。

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
        "使用一到两句话写成的中文整体聆听感受，不要写成正式乐评。",
    },

    comments: {
      type: Type.ARRAY,
      description:
        "按照时间从小到大排列的即时音乐陪伴评论。",

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
              "简短、自然、像朋友一起听歌时说出的中文即时评论。",
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

              temperature: 0.75,
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