import {
  describe,
  expect,
  it,
} from "vitest";

import type { DemoComment } from "@/types/music";

import {
  evaluatePlaybackWindow,
  getCommentIdsAtOrBefore,
  sortCommentsByTime,
} from "@/utils/commentScheduler";

const comments: DemoComment[] = [
  {
    id: "comment-1",
    timeSeconds: 8,
    eventType: "intro",
    comment:
      "这个开头好安静，像故事还没真正开始。",
  },
  {
    id: "comment-2",
    timeSeconds: 24,
    eventType: "emotion_shift",
    comment:
      "旋律好像正在一点点靠近。",
  },
  {
    id: "comment-3",
    timeSeconds: 43,
    eventType: "rhythm_entry",
    comment:
      "这一进来，整首突然开始往前走了。",
  },
  {
    id: "comment-4",
    timeSeconds: 68,
    eventType: "pause",
    comment:
      "刚才那个停顿，像一句话没有说完。",
  },
  {
    id: "comment-5",
    timeSeconds: 96,
    eventType: "theme_return",
    comment:
      "这个旋律再次出现时，比第一次更有感觉。",
  },
];

describe("sortCommentsByTime", () => {
  it("按照评论时间从小到大排序", () => {
    const unordered = [
      comments[2],
      comments[0],
      comments[1],
    ];

    const result =
      sortCommentsByTime(unordered);

    expect(
      result.map(
        (comment) =>
          comment.timeSeconds,
      ),
    ).toEqual([8, 24, 43]);
  });

  it("不会修改原始评论数组", () => {
    const unordered = [
      comments[2],
      comments[0],
    ];

    sortCommentsByTime(unordered);

    expect(
      unordered.map(
        (comment) => comment.id,
      ),
    ).toEqual([
      "comment-3",
      "comment-1",
    ]);
  });
});

describe(
  "getCommentIdsAtOrBefore",
  () => {
    it("返回当前位置之前的评论ID", () => {
      const result =
        getCommentIdsAtOrBefore(
          comments,
          45,
        );

      expect(result).toEqual([
        "comment-1",
        "comment-2",
        "comment-3",
      ]);
    });

    it("时间无效时返回空数组", () => {
      const result =
        getCommentIdsAtOrBefore(
          comments,
          Number.NaN,
        );

      expect(result).toEqual([]);
    });
  },
);

describe(
  "evaluatePlaybackWindow",
  () => {
    it("正常经过8秒时触发第一条评论", () => {
      const result =
        evaluatePlaybackWindow({
          comments,
          triggeredIds: new Set(),
          previousTime: 7.8,
          currentTime: 8.2,
        });

      expect(result.type).toBe(
        "trigger",
      );

      expect(result.comment?.id).toBe(
        "comment-1",
      );

      expect(result.idsToMark).toEqual([
        "comment-1",
      ]);
    });

    it("不会重复触发已经出现的评论", () => {
      const result =
        evaluatePlaybackWindow({
          comments,

          triggeredIds: new Set([
            "comment-1",
          ]),

          previousTime: 7.8,
          currentTime: 8.2,
        });

      expect(result.type).toBe("none");
      expect(result.comment).toBeNull();
      expect(result.idsToMark).toEqual(
        [],
      );
    });

    it("没有经过评论时间点时不触发", () => {
      const result =
        evaluatePlaybackWindow({
          comments,
          triggeredIds: new Set(),
          previousTime: 10,
          currentTime: 11,
        });

      expect(result.type).toBe("none");
      expect(result.comment).toBeNull();
    });

    it("从10秒快进到90秒时不补发中间评论", () => {
      const result =
        evaluatePlaybackWindow({
          comments,

          triggeredIds: new Set([
            "comment-1",
          ]),

          previousTime: 10,
          currentTime: 90,
        });

      expect(result.type).toBe("skip");
      expect(result.comment).toBeNull();

      expect(result.idsToMark).toEqual([
        "comment-2",
        "comment-3",
        "comment-4",
      ]);
    });

    it("快进到90秒后仍能触发96秒评论", () => {
      const result =
        evaluatePlaybackWindow({
          comments,

          triggeredIds: new Set([
            "comment-1",
            "comment-2",
            "comment-3",
            "comment-4",
          ]),

          previousTime: 95.8,
          currentTime: 96.2,
        });

      expect(result.type).toBe(
        "trigger",
      );

      expect(result.comment?.id).toBe(
        "comment-5",
      );
    });

    it("倒退时不会重新触发旧评论", () => {
      const result =
        evaluatePlaybackWindow({
          comments,

          triggeredIds: new Set([
            "comment-1",
            "comment-2",
          ]),

          previousTime: 30,
          currentTime: 5,
        });

      expect(result.type).toBe("none");
      expect(result.comment).toBeNull();
      expect(result.idsToMark).toEqual(
        [],
      );
    });

    it("一次时间更新最多触发一条评论", () => {
      const result =
        evaluatePlaybackWindow({
          comments,
          triggeredIds: new Set(),
          previousTime: 7.5,
          currentTime: 24.2,

          /**
           * 测试时提高阈值，
           * 避免这次变化被判定为快进。
           */
          maxContinuousTimeJump: 30,
        });

      expect(result.type).toBe(
        "trigger",
      );

      expect(result.comment?.id).toBe(
        "comment-1",
      );

      expect(result.idsToMark).toEqual([
        "comment-1",
      ]);
    });

    it("无效播放时间不会触发评论", () => {
      const result =
        evaluatePlaybackWindow({
          comments,
          triggeredIds: new Set(),
          previousTime: Number.NaN,
          currentTime: 8,
        });

      expect(result.type).toBe("none");
      expect(result.comment).toBeNull();
    });

    it("没有评论数据时不会报错", () => {
      const result =
        evaluatePlaybackWindow({
          comments: [],
          triggeredIds: new Set(),
          previousTime: 7,
          currentTime: 8,
        });

      expect(result.type).toBe("none");
      expect(result.comment).toBeNull();
    });

    it("短音乐不会导致调度逻辑异常", () => {
      expect(() =>
        evaluatePlaybackWindow({
          comments,
          triggeredIds: new Set(),
          previousTime: 38,
          currentTime: 40,
        }),
      ).not.toThrow();
    });
  },
);