/**
 * 评论事件类型
 */
export type EventType =
  | "intro"
  | "emotion_shift"
  | "rhythm_entry"
  | "pause"
  | "theme_return";

/**
 * 人工预设的伙伴评论
 */
export interface DemoComment {
  id: string;
  timeSeconds: number;
  eventType: EventType;
  comment: string;
}

/**
 * 播放器向页面提供的状态
 */
export interface PlaybackSnapshot {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isSeeking: boolean;
}

/**
 * 评论反馈类型
 * 阶段5使用
 */
export type CommentFeedback = "agree" | "different";

/**
 * 共同聆听记录中的消息
 * 阶段5使用
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
    