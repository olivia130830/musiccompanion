"use client";

import type { CSSProperties } from "react";

export type VoiceInputStatus =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "sending"
  | "speaking";

interface UserReplyBoxProps {
  disabled: boolean;
  status: VoiceInputStatus;
  error: string;
  inputDeviceLabel?: string;
  isPlayingReply: boolean;
  aiVolume: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onStopReply: () => void;
  onAiVolumeChange: (volume: number) => void;
}

function getStatusText(disabled: boolean, status: VoiceInputStatus) {
  if (disabled) return "先选择一首音乐";
  if (status === "requesting_permission") return "正在连接麦克风…";
  if (status === "recording") return "正在听你说，再点一次结束";
  if (status === "sending") return "正在把这句话交给 AI…";
  if (status === "speaking") return "AI 正在回应你";
  return "轻点麦克风，说一句";
}

export default function UserReplyBox({
  disabled,
  status,
  error,
  inputDeviceLabel,
  isPlayingReply,
  aiVolume,
  onStartRecording,
  onStopRecording,
  onStopReply,
  onAiVolumeChange,
}: UserReplyBoxProps) {
  const isRecording = status === "recording";
  const isBusy =
    status === "requesting_permission" || status === "sending";

  return (
    <section className="reply-box voice-call-box" aria-labelledby="voice-reply-label">
      <div className="voice-call-heading">
        <span className={`voice-call-presence ${isRecording || isPlayingReply ? "voice-call-presence-active" : ""}`} />
        <p id="voice-reply-label" className="reply-label">
          语音陪听
        </p>
      </div>

      <div className={`voice-call-stage ${isRecording ? "voice-call-stage-listening" : ""} ${isPlayingReply ? "voice-call-stage-speaking" : ""}`}>
        <span className="voice-call-ring voice-call-ring-one" aria-hidden="true" />
        <span className="voice-call-ring voice-call-ring-two" aria-hidden="true" />

        <button
          className={`voice-record-button${
            isRecording ? " voice-record-button-active" : ""
          }`}
          type="button"
          disabled={disabled || isBusy}
          aria-pressed={isRecording}
          aria-label={isRecording ? "结束说话" : "开始说话"}
          onClick={isRecording ? onStopRecording : onStartRecording}
        >
          <span className="voice-mic-icon" aria-hidden="true">
            {isRecording ? "■" : "●"}
          </span>
        </button>
      </div>

      <p className="voice-record-status" aria-live="polite">
        {getStatusText(disabled, status)}
      </p>

      <div className="ai-volume-control">
        <div className="ai-volume-heading">
          <span className="ai-volume-label">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2-4.03v8.06A4.5 4.5 0 0 0 16.5 12Zm0-8.48v2.06a7 7 0 0 1 0 12.84v2.06a9 9 0 0 0 0-16.96Z" />
            </svg>
            AI 音量
          </span>
          <output htmlFor="ai-volume-slider">
            {Math.round(aiVolume * 100)}%
          </output>
        </div>
        <input
          id="ai-volume-slider"
          className="ai-volume-slider"
          type="range"
          min="0"
          max="100"
          step="5"
          value={Math.round(aiVolume * 100)}
          aria-label="调整 AI 回复音量"
          aria-valuetext={`${Math.round(aiVolume * 100)}%`}
          onInput={(event) => {
            onAiVolumeChange(Number(event.currentTarget.value) / 100);
          }}
          style={
            {
              "--ai-volume-progress": `${aiVolume * 100}%`,
            } as CSSProperties
          }
        />
      </div>

      {inputDeviceLabel && (
        <p className="voice-record-status">
          当前麦克风：{inputDeviceLabel}
        </p>
      )}

      {isPlayingReply && (
        <button
          type="button"
          className="voice-secondary-button"
          onClick={onStopReply}
        >
          停止 AI 语音
        </button>
      )}

      {error && (
        <p className="voice-record-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
