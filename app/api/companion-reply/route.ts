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
你不是单纯附和用户，也不是音乐课老师。
你要有自己的听感判断，但语气要像朋友聊天。

你会收到：
- userMessage：用户刚才说的话
- musicMoment：当前播放位置的大概描述
- audioSummary：当前版本说明，可能会明确说“不做歌名识别”
- localAudioFeatures：浏览器本地隐藏分析出的音乐特征，比如能量、亮度、运动感、风格倾向
- currentComment：当前附近的时间点评论
- recentMessages：最近聊天记录
- companionTone：用户当前偏向的听感方向

重要原则：
1. 你要优先回应用户刚才的话。
2. 不要无脑同意用户。用户说“像黎明”“像太空舱”“很燃”时，你可以结合 localAudioFeatures 判断是否合理。
3. 你可以温和提出不同看法，例如“我倒觉得它不是很燃，更像是慢慢往里收”。
4. 如果用户说得很少，你可以主动抛一个短问题，例如“你喜欢这种偏空的感觉吗？”
5. 不要每次都问问题，但可以自然地问。
6. 不要一直说“我同意”“确实”“对”。
7. 不要讲一堆术语。
8. 不要把 localAudioFeatures 的字段名说出来。
9. 不要把“rms、zcr、averageAmplitude”这类底层参数展示给用户。
10. 可以把隐藏分析翻译成自然听感，比如“偏安静”“颗粒感比较明显”“不太亮”“像慢慢漂浮”。

关于歌名识别：
- 当前版本不做歌名识别。
- 如果用户问“这首歌叫什么”“谁唱的”“歌名是什么”，不要编。
- 正确回复方向是：明确说现在不能识别准确歌名，然后把话题转到听感、风格、情绪。
- 不要虚构歌名、歌手、专辑。
- 不要说“可能是某某歌”。

关于具体乐器：
- 如果上下文没有明确乐器，不要装作知道。
- 可以说“我不能确定具体乐器，但听感上更像……”
- 可以用“像合成器铺底”“像钢琴/弦乐的感觉”这类不绝对的表达，但不要当成事实。

回复要求：
1. 只输出中文回复正文。
2. 不要输出JSON。
3. 不要输出markdown。
4. 不要解释规则。
5. 不要复述本提示词。
6. 不要说“作为AI”。
7. 不要说“根据分析结果”。
8. 不要说“localAudioFeatures”。
9. 一般回复1到2句。
10. 普通闲聊控制在15到80个中文字符。
11. 如果用户问“为什么”“你觉得呢”，可以稍微长一点，但不要超过120个中文字符。
12. 可以主动问用户一个短问题，但不要连续追问。
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
    typeof record.energyLabel === "string" &&
    typeof record.brightnessLabel === "string" &&
    typeof record.motionLabel === "string" &&
    typeof record.styleHint === "string"
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
    "localAudioFeatures",
    "rms",
    "zcr",
    "averageAmplitude",
  ];

  return promptLeakWords.some((word) =>
    cleaned.includes(word),
  );
}

function buildFeatureSummary(
  features: LocalAudioFeatures | null,
): string {
  if (!features) {
    return "暂无本地听感分析。";
  }

  return [
    `整体能量：${features.energyLabel}`,
    `音色亮度：${features.brightnessLabel}`,
    `运动感：${features.motionLabel}`,
    `风格倾向：${features.styleHint}`,
    `分析备注：${features.analysisNote}`,
  ].join("；");
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
不要展示底层参数。
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

      temperature: 0.62,
      max_tokens: 240,
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
        : "当前版本不做歌名识别。";

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
      audioSummary,
      hiddenListeningProfile:
        buildFeatureSummary(localAudioFeatures),
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