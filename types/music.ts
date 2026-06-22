/**
 * 音乐评论所对应的事件类型。
 */
export type EventType =
  | "intro"
  | "emotion_shift"
  | "rhythm_entry"
  | "pause"
  | "theme_return";

/**
 * 阶段9：共同聆听时，用户表达出的偏好或情绪方向。
 *
 * 这不是医学或心理判断，只是用于调整AI评论语气。
 */
export type CompanionTone =
  | "unknown"
  | "quiet"
  | "excited"
  | "sad"
  | "warm"
  | "curious";

/**
 * 一条带时间点的音乐评论。
 *
 * 这个类型既可以表示原来的人工演示评论，
 * 也可以表示 Gemini 生成的评论。
 */
export interface DemoComment {
  id: string;
  timeSeconds: number;
  eventType: EventType;
  comment: string;
}

/**
 * 播放器向页面传递的状态。
 */
export interface PlaybackSnapshot {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isSeeking: boolean;
}

/**
 * 用户对伙伴评论的反馈。
 */
export type CommentFeedback =
  | "agree"
  | "different";

/**
 * 伙伴发出的历史消息。
 */
export interface CompanionMessage {
  id: string;
  sender: "companion";
  text: string;
  musicTimeSeconds: number;
  commentId: string;
}

/**
 * 用户发出的历史消息。
 */
export interface UserMessage {
  id: string;
  sender: "user";
  text: string;
  musicTimeSeconds: number;
}

/**
 * 共同聆听记录中的一条消息。
 */
export type ListeningMessage =
  | CompanionMessage
  | UserMessage;

/**
 * 音频分析过程的状态。
 */
export type AudioAnalysisStatus =
  | "idle"
  | "uploading"
  | "analyzing"
  | "success"
  | "error"
  | "fallback";

/**
 * Gemini音频分析结果。
 */
export interface AudioAnalysisResult {
  summary: string;
  comments: DemoComment[];
  model: string;
}