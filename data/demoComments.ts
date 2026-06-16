import { DemoComment } from "@/types/music";

/**
 * 人工预设的测试评论
 * V0 版本使用这些时间点和内容作为演示
 */
export const demoComments: DemoComment[] = [
  {
    id: "comment-1",
    timeSeconds: 8,
    eventType: "intro",
    comment: "这个开头好安静，像故事还没真正开始。",
  },
  {
    id: "comment-2",
    timeSeconds: 24,
    eventType: "emotion_shift",
    comment: "旋律好像正在一点点靠近。",
  },
  {
    id: "comment-3",
    timeSeconds: 43,
    eventType: "rhythm_entry",
    comment: "这一进来，整首突然开始往前走了。",
  },
  {
    id: "comment-4",
    timeSeconds: 68,
    eventType: "pause",
    comment: "刚才那个停顿，像一句话没有说完。",
  },
  {
    id: "comment-5",
    timeSeconds: 96,
    eventType: "theme_return",
    comment: "这个旋律再次出现时，比第一次更有感觉。",
  },
];
