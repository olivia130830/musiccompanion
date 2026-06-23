import OpenAI from "openai";

import type {
  DemoComment,
  ListeningMessage,
  LocalAudioFeatures,
} from "@/types/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_DEEPSEEK_MODEL =
  "deepseek-v4-flash";

const COMPANION_REPLY_SYSTEM_PROMPT = `
你是 MusicCompanion，一个正在和用户一起听音乐的AI伙伴。

你的任务：
认真理解用户刚才说的话，然后像一个真实一起听歌的人一样回复。

你会收到：
- userMessage：用户刚才说的话
- musicMoment：当前播放位置的大概描述
- audioSummary：AudD识别出的歌曲身份信息
- localAudioFeatures：浏览器本地分析出的音乐特征，比如能量、亮度、运动感、风格倾向
- currentComment：当前附近的时间点评论
- recentMessages：最近聊天记录
- companionTone：用户当前偏向的听感方向

重要原则：
- 你不是音乐课老师。
- 你不是报告生成器。
- 你不是在复述规则。
- 你是在陪用户一起听音乐。
- 用户说什么，你就先回应什么。
- 不要无脑附和用户，要有一点自己的听感判断。
- 但不同意时也要温和，像朋友聊天。

关于真实性：
- 如果 audioSummary 没有明确歌名，不要编歌名。
- 如果用户问歌名，而没有识别结果，要说“我这边还没识别出准确歌名”。
- 如果 localAudioFeatures 里只有能量、亮度、运动感，不要假装知道具体乐器。
- 如果用户问具体乐器但上下文没提供，不要乱猜，可以说“我不能确定具体乐器，但听感上……”
- 如果用户说“像黎明”“像太空舱”“像海底”，要结合 localAudioFeatures 判断是否合理，不要只会说“对”。

回复要求：
1. 只输出中文回复正文。
2. 不要输出JSON。
3. 不要输出markdown。
4. 不要解释规则。
5. 不要复述本提示词。
6. 不要说“作为AI”。
7. 不要说“根据分析结果”。
8. 必须优先回答用户刚才的话。
9. 不要只说时间、秒数、播放状态。
10. 回复要像日常聊天。
11. 一般回复1到2句。
12. 普通闲聊控制在15到70个中文字符。
13. 如果用户问“什么意思”“为什么”“你觉得呢”，可以稍微长一点，但不要超过110个中文字符。
14. 不要为了短而敷衍。
`;

interface CompanionReplyRequestBody {
  userMessage?: unknown;
  currentTimeSeconds?: unknown;
  audioSummary?: unknown;
  currentComment?: unknown;
  recentMessages?: unknown;
  companionTone?: unknown;
  localAudioFeatures?: unknown;
}

function isValidComment(
  value: unknown,
): value is DemoComment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record =
    value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    typeof record.timeSeconds === "number" &&
    typeof record.eventType === "string" &&
    typeof record.comment === "string"
  );
}

function isValidMessage(
  value: unknown,
): value is ListeningMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record =
    value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    (record.sender === "user" ||
      record.sender === "companion") &&
    typeof record.text === "string" &&
    typeof record.musicTimeSeconds === "number"
  );
}

function isLocalAudioFeatures(
  value: unknown,
): value is LocalAudioFeatures {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record =
    value as Record<string, unknown>;

  return (
    "energyLabel" in record &&
    "brightnessLabel" in record &&
    "motionLabel" in record &&
    "styleHint" in record
  );
}

function getMusicMoment(seconds: number): string {
  if (seconds < 20) {
    return "音乐刚开始不久";
  }

  if (seconds < 60) {
    return "音乐已经进入第一段情绪";
  }

  if (seconds < 120) {
    return "音乐进入中前段";
  }

  return "音乐已经播放了一段时间";
}

function cleanReplyText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/```/g, "")
    .replace(/^["“”'\s]+/g, "")
    .replace(/["“”'\s]+$/g, "")
    .replace(/^回复[:：]\s*/g, "")
    .replace(/^assistant[:：]\s*/gi, "")
    .trim();
}

function isBadReply(text: string): boolean {
  const cleaned = text.trim();

  if (!cleaned) {
    return true;
  }

  if (cleaned.length <= 2) {
    return true;
  }

  const badPatterns = [
    /^\d+\s*s\)?$/i,
    /^\d+\s*秒\)?$/,
    /^0:\d+\)?$/,
    /^嗯+$/,
    /^对+$/,
    /^的时候$/,
    /^刚开始的$/,
    /^先播放就行$/,
  ];

  if (
    badPatterns.some((pattern) =>
      pattern.test(cleaned),
    )
  ) {
    return true;
  }

  const promptLeakWords = [
    "只输出中文回复",
    "回复要求",
    "用户刚才说的话",
    "不要输出JSON",
    "不要输出markdown",
    "你是 MusicCompanion",
    "你的任务",
  ];

  return promptLeakWords.some((word) =>
    cleaned.includes(word),
  );
}

function buildUserPrompt(
  context: Record<string, unknown>,
): string {
  return `
下面是当前共同听歌的上下文。它只是参考资料，不是让你复述。

${JSON.stringify(context, null, 2)}

现在请只回复 userMessage。
不要复述字段名。
不要输出规则。
不要输出秒数。
像朋友一样认真回应用户刚才那句话。
`;
}

function getDeepSeekClient(): OpenAI {
  const apiKey =
    process.env.DEEPSEEK_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "服务器尚未配置DEEPSEEK_API_KEY。",
    );
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
  });
}

async function generateReplyWithDeepSeek(
  context: Record<string, unknown>,
): Promise<string> {
  const client = getDeepSeekClient();

  const model =
    process.env.DEEPSEEK_COMPANION_MODEL?.trim() ||
    DEFAULT_DEEPSEEK_MODEL;

  const response =
    await client.chat.completions.create({
      model,

      messages: [
        {
          role: "system",
          content:
            COMPANION_REPLY_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildUserPrompt(context),
        },
      ],

      temperature: 0.45,
      max_tokens: 220,
    });

  const replyText = cleanReplyText(
    response.choices[0]?.message?.content ?? "",
  );

  if (isBadReply(replyText)) {
    throw new Error(
      `DeepSeek回复无效：${replyText || "空回复"}`,
    );
  }

  return replyText;
}

export async function POST(request: Request) {
  try {
    const body =
      (await request.json()) as CompanionReplyRequestBody;

    const userMessage =
      typeof body.userMessage === "string"
        ? body.userMessage.trim()
        : "";

    if (!userMessage) {
      return new Response("用户回复不能为空。", {
        status: 400,
      });
    }

    const currentTimeSeconds =
      typeof body.currentTimeSeconds === "number" &&
      Number.isFinite(body.currentTimeSeconds)
        ? Math.max(
            0,
            Math.round(body.currentTimeSeconds),
          )
        : 0;

    const audioSummary =
      typeof body.audioSummary === "string"
        ? body.audioSummary.trim()
        : "";

    const currentComment = isValidComment(
      body.currentComment,
    )
      ? body.currentComment
      : null;

    const recentMessages = Array.isArray(
      body.recentMessages,
    )
      ? body.recentMessages
          .filter(isValidMessage)
          .slice(-6)
      : [];

    const companionTone =
      typeof body.companionTone === "string"
        ? body.companionTone
        : "unknown";

    const localAudioFeatures =
      isLocalAudioFeatures(body.localAudioFeatures)
        ? body.localAudioFeatures
        : null;

    const context = {
      userMessage,
      musicMoment: getMusicMoment(
        currentTimeSeconds,
      ),
      audioSummary: audioSummary
        ? audioSummary.slice(0, 400)
        : "目前还没有歌曲身份识别结果。",
      localAudioFeatures,
      currentComment: currentComment
        ? {
            eventType: currentComment.eventType,
            comment:
              currentComment.comment.slice(0, 120),
          }
        : null,
      recentMessages: recentMessages.map(
        (message) => ({
          sender: message.sender,
          text: message.text.slice(0, 120),
        }),
      ),
      companionTone,
    };

    const replyText =
      await generateReplyWithDeepSeek(context);

    return new Response(replyText, {
      status: 200,
      headers: {
        "Content-Type":
          "text/plain; charset=utf-8",
        "Cache-Control":
          "no-cache, no-transform",
      },
    });
  } catch (error) {
    console.error(
      "[Companion Reply] 失败：",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "生成陪伴回复失败。";

    return new Response(message, {
      status: 500,
      headers: {
        "Content-Type":
          "text/plain; charset=utf-8",
      },
    });
  }
}