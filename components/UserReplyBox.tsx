"use client";

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
  onStartRecording: () => void;
  onStopRecording: () => void;
  onStopReply: () => void;
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
  onStartRecording,
  onStopRecording,
  onStopReply,
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
