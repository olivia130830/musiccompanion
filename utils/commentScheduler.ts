import type { DemoComment } from "@/types/music";

/**
 * 两次播放时间相差超过此数值时，
 * 认为发生了快进，而不是正常连续播放。
 */
export const DEFAULT_MAX_CONTINUOUS_TIME_JUMP = 2.5;

interface EvaluatePlaybackWindowOptions {
  comments: readonly DemoComment[];
  triggeredIds: ReadonlySet<string>;
  previousTime: number;
  currentTime: number;
  maxContinuousTimeJump?: number;
}

export type PlaybackWindowDecision =
  | {
      type: "none";
      idsToMark: string[];
      comment: null;
    }
  | {
      type: "skip";
      idsToMark: string[];
      comment: null;
    }
  | {
      type: "trigger";
      idsToMark: string[];
      comment: DemoComment;
    };

/**
 * 返回按照时间从小到大排序的新数组。
 * 不修改传入的原数组。
 */
export function sortCommentsByTime(
  comments: readonly DemoComment[],
): DemoComment[] {
  return [...comments].sort(
    (first, second) =>
      first.timeSeconds - second.timeSeconds,
  );
}

/**
 * 获取当前位置之前或刚好到达当前位置的评论ID。
 *
 * 用户向前快进后，这些评论会被视为已经错过，
 * 不会再批量补发。
 */
export function getCommentIdsAtOrBefore(
  comments: readonly DemoComment[],
  currentTime: number,
): string[] {
  if (!Number.isFinite(currentTime)) {
    return [];
  }

  return comments
    .filter(
      (comment) =>
        comment.timeSeconds <= currentTime,
    )
    .map((comment) => comment.id);
}

/**
 * 判断一次播放时间变化应该进行什么操作。
 *
 * none：
 * 不触发评论。
 *
 * skip：
 * 发生快进，把中间评论标记为已经错过。
 *
 * trigger：
 * 正常经过一个评论时间点，触发一条评论。
 */
export function evaluatePlaybackWindow({
  comments,
  triggeredIds,
  previousTime,
  currentTime,
  maxContinuousTimeJump =
    DEFAULT_MAX_CONTINUOUS_TIME_JUMP,
}: EvaluatePlaybackWindowOptions): PlaybackWindowDecision {
  if (
    !Number.isFinite(previousTime) ||
    !Number.isFinite(currentTime)
  ) {
    return {
      type: "none",
      idsToMark: [],
      comment: null,
    };
  }

  const sortedComments =
    sortCommentsByTime(comments);

  const timeDifference =
    currentTime - previousTime;

  /**
   * 时间明显减少，说明用户倒退了。
   *
   * 已经触发的评论不清空，
   * 也不重新触发。
   */
  if (timeDifference < -0.5) {
    return {
      type: "none",
      idsToMark: [],
      comment: null,
    };
  }

  /**
   * 时间突然向前跨越较大范围，
   * 认为发生了快进。
   */
  if (
    timeDifference >
    maxContinuousTimeJump
  ) {
    const idsToMark = sortedComments
      .filter(
        (comment) =>
          comment.timeSeconds <= currentTime &&
          !triggeredIds.has(comment.id),
      )
      .map((comment) => comment.id);

    return {
      type: "skip",
      idsToMark,
      comment: null,
    };
  }

  /**
   * 正常播放时，寻找刚刚经过的第一条
   * 尚未触发的评论。
   */
  const nextComment = sortedComments.find(
    (comment) =>
      !triggeredIds.has(comment.id) &&
      comment.timeSeconds > previousTime &&
      comment.timeSeconds <= currentTime,
  );

  if (!nextComment) {
    return {
      type: "none",
      idsToMark: [],
      comment: null,
    };
  }

  return {
    type: "trigger",
    idsToMark: [nextComment.id],
    comment: nextComment,
  };
}