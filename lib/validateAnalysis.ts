import type {
  AudioAnalysisResult,
  DemoComment,
  EventType,
} from "@/types/music";

const EVENT_TYPES: readonly EventType[] = [
  "intro",
  "emotion_shift",
  "rhythm_entry",
  "pause",
  "theme_return",
];

const MIN_COMMENT_TIME_SECONDS = 5;
const MAX_COMMENT_TIME_SECONDS = 60 * 60 * 4;
const MIN_COMMENT_GAP_SECONDS = 5;
const MAX_COMMENT_LENGTH = 80;
const MAX_COMMENT_COUNT = 8;
const MIN_COMMENT_COUNT = 3;

interface RawAnalysisComment {
  timeSeconds?: unknown;
  eventType?: unknown;
  comment?: unknown;
}

interface RawAnalysisResult {
  summary?: unknown;
  comments?: unknown;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isEventType(
  value: unknown,
): value is EventType {
  return (
    typeof value === "string" &&
    EVENT_TYPES.includes(
      value as EventType,
    )
  );
}

function parseComment(
  value: unknown,
  index: number,
): DemoComment | null {
  if (!isRecord(value)) {
    return null;
  }

  const raw = value as RawAnalysisComment;

  const timeSeconds =
    typeof raw.timeSeconds === "number"
      ? raw.timeSeconds
      : Number(raw.timeSeconds);

  if (
    !Number.isFinite(timeSeconds) ||
    timeSeconds <
      MIN_COMMENT_TIME_SECONDS ||
    timeSeconds >
      MAX_COMMENT_TIME_SECONDS
  ) {
    return null;
  }

  if (!isEventType(raw.eventType)) {
    return null;
  }

  if (typeof raw.comment !== "string") {
    return null;
  }

  const comment = raw.comment
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COMMENT_LENGTH);

  if (!comment) {
    return null;
  }

  return {
    id: `ai-comment-${index + 1}`,
    timeSeconds:
      Math.round(timeSeconds * 10) / 10,
    eventType: raw.eventType,
    comment,
  };
}

/**
 * 校验并清理Gemini返回的分析结果。
 *
 * 模型返回的数据即使符合JSON结构，
 * 仍然需要在服务端再次验证。
 */
export function validateAnalysisResult(
  value: unknown,
  model: string,
): AudioAnalysisResult {
  if (!isRecord(value)) {
    throw new Error(
      "AI返回的分析结果不是有效对象。",
    );
  }

  const raw = value as RawAnalysisResult;

  const summary =
    typeof raw.summary === "string"
      ? raw.summary
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240)
      : "";

  if (!Array.isArray(raw.comments)) {
    throw new Error(
      "AI没有返回有效的评论列表。",
    );
  }

  const parsedComments = raw.comments
    .map((comment, index) =>
      parseComment(comment, index),
    )
    .filter(
      (
        comment,
      ): comment is DemoComment =>
        comment !== null,
    )
    .sort(
      (first, second) =>
        first.timeSeconds -
        second.timeSeconds,
    );

  /**
   * 删除时间过于接近的评论，
   * 避免几秒内连续弹出多条内容。
   */
  const spacedComments: DemoComment[] = [];

  for (const comment of parsedComments) {
    const previous =
      spacedComments[
        spacedComments.length - 1
      ];

    if (
      previous &&
      comment.timeSeconds -
        previous.timeSeconds <
        MIN_COMMENT_GAP_SECONDS
    ) {
      continue;
    }

    spacedComments.push({
      ...comment,
      id: `ai-comment-${
        spacedComments.length + 1
      }`,
    });

    if (
      spacedComments.length >=
      MAX_COMMENT_COUNT
    ) {
      break;
    }
  }

  if (
    spacedComments.length <
    MIN_COMMENT_COUNT
  ) {
    throw new Error(
      "AI返回的有效评论数量太少，请重新分析。",
    );
  }

  return {
    summary:
      summary ||
      "已经完成这首音乐的共同聆听分析。",
    comments: spacedComments,
    model,
  };
}