/**
 * 评论事件类型
 * - intro: 开头或过渡
 * - emotion_shift: 情绪变化
 * - rhythm_entry: 节奏进入或变化
 * - pause: 停顿或静寂
 * - theme_return: 主题再次出现
 */
export type EventType = "intro" | "emotion_shift" | "rhythm_entry" | "pause" | "theme_return";

/**
 * AI 伙伴评论
 */
export interface DemoComment {
  id: string;
  timeSeconds: number;
  eventType: EventType;
  comment: string;
}

/**
 * 评论反馈类型
 */
export type CommentFeedback = "agree" | "different";

/**
 * 共同聆听记录中的消息
 */
export type ListeningMessage =
  | {
      id: string;
      sender: "companion";
      text: string;
      musicTimeSeconds: number;
      commentId: string;
    }
  | {
      id: string;
      sender: "user";
      text: string;
      musicTimeSeconds: number;
    };
