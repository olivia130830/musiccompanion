export type EventType =
  | "intro"
  | "emotion_shift"
  | "rhythm_entry"
  | "pause"
  | "theme_return";

export type CompanionTone =
  | "unknown"
  | "quiet"
  | "excited"
  | "sad"
  | "warm"
  | "curious";

export type CompanionPreference =
  | "none"
  | "less_talk"
  | "more_react";

export type UserListeningIntent =
  | "music_observation"
  | "personal_feeling"
  | "question"
  | "companion_request"
  | "general_reply";

export interface DemoComment {
  id: string;
  timeSeconds: number;
  eventType: EventType;
  comment: string;
}

export interface PlaybackSnapshot {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isSeeking: boolean;
}

export type CommentFeedback = "agree" | "different";

export interface CompanionMessage {
  id: string;
  sender: "companion";
  text: string;
  musicTimeSeconds: number;
  commentId?: string;
}

export interface UserMessage {
  id: string;
  sender: "user";
  text: string;
  musicTimeSeconds: number;
}

export type ListeningMessage =
  | CompanionMessage
  | UserMessage;

export type AudioAnalysisStatus =
  | "idle"
  | "uploading"
  | "analyzing"
  | "success"
  | "error"
  | "fallback";

export interface TrackIdentity {
  title: string | null;
  artist: string | null;
  album: string | null;
  source: "audd" | "none";
  confidenceText: string;
}

export interface LocalAudioFeatures {
  durationSeconds: number | null;
  sampleRate: number | null;
  channels: number | null;

  rms: number | null;
  averageAmplitude: number | null;
  zeroCrossingRate: number | null;

  energyLabel: string;
  brightnessLabel: string;
  motionLabel: string;
  styleHint: string;
  analysisNote: string;
}

export interface AudioAnalysisResult {
  summary: string;
  comments: DemoComment[];
  model: string;
  trackIdentity?: TrackIdentity;
}

export interface CompanionReplyResult {
  replyText: string;
  tone: CompanionTone;
  intent: UserListeningIntent;
  companionPreference: CompanionPreference;
}