/**

 * 人工评论对应的音乐事件类型。

 */

export type EventType =

  | "intro"

  | "emotion_shift"

  | "rhythm_entry"

  | "pause"

  | "theme_return";

/**

 * 人工预设的伙伴评论。

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

export type CommentFeedback = "agree" | "different";

/**

 * 伙伴发出的消息。

 */

export interface CompanionMessage {

  id: string;

  sender: "companion";

  text: string;

  musicTimeSeconds: number;

  commentId: string;

}

/**

 * 用户发出的消息。

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