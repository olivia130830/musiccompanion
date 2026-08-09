"use client";

import type { VoiceRecording } from "@/hooks/useVoiceRecorder";

export type VoiceInputStatus =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "sending"
  | "speaking";

interface UserReplyBoxProps {
  disabled: boolean;
  status: VoiceInputStatus;
  recording: VoiceRecording | null;
  error: string;
  inputDeviceLabel?: string;
  isPlayingReply: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onStopReply: () => void;
  onDiscardRecording: () => void;
}

function getStatusText(disabled: boolean, status: VoiceInputStatus) {
  if (disabled) return "先选择一首音乐";
  if (status === "requesting_permission") return "正在请求麦克风权限…";
  if (status === "recording") return "正在录音，再点一次停止";
  if (status === "sending") return "正在发送给 AI…";
  if (status === "speaking") return "AI 正在播放语音回复";
  return "点一下开始录音";
}

export default function UserReplyBox({
  disabled,
  status,
  recording,
  error,
  inputDeviceLabel,
  isPlayingReply,
  onStartRecording,
  onStopRecording,
  onStopReply,
  onDiscardRecording,
}: UserReplyBoxProps) {
  const isRecording = status === "recording";
  const isBusy =
    status === "requesting_permission" || status === "sending";

  return (
    <section className="reply-box" aria-labelledby="voice-reply-label">
      <p id="voice-reply-label" className="reply-label">
        用语音分享你此刻的感受
      </p>

      <button
        className={`voice-record-button${
          isRecording ? " voice-record-button-active" : ""
        }`}
        type="button"
        disabled={disabled || isBusy}
        aria-pressed={isRecording}
        onClick={isRecording ? onStopRecording : onStartRecording}
      >
        <span aria-hidden="true">{isRecording ? "■" : "●"}</span>
        <span>{isRecording ? "停止录音" : "开始录音"}</span>
      </button>

      <p className="voice-record-status" aria-live="polite">
        {getStatusText(disabled, status)}
      </p>

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

      {recording && (
        <div className="voice-recording-preview">
          <audio controls preload="metadata" src={recording.previewUrl}>
            当前浏览器不支持音频试听。
          </audio>

          <div className="voice-recording-actions">
            <a
              className="voice-download-link"
              href={recording.previewUrl}
              download={recording.file.name}
            >
              下载录音
            </a>

            <button
              type="button"
              className="voice-secondary-button"
              disabled={isBusy}
              onClick={onDiscardRecording}
            >
              重录
            </button>

          </div>
        </div>
      )}

      {error && (
        <p className="voice-record-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
