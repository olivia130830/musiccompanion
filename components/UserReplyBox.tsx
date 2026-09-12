"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

export type VoiceInputStatus =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "sending"
  | "speaking";

export type CommunicationMode = "voice" | "text";

export function getTapRecordingAction(
  isGestureActive: boolean,
  status: VoiceInputStatus,
  isStartPending: boolean,
) {
  return isGestureActive &&
    (status === "recording" || isStartPending)
    ? "stop"
    : "start";
}

interface UserReplyBoxProps {
  disabled: boolean;
  status: VoiceInputStatus;
  error: string;
  inputDeviceLabel?: string;
  isMicrophoneMuted: boolean;
  musicContinuesWhenMicrophoneMuted: boolean;
  isSpeakerMuted: boolean;
  isCallConnected: boolean;
  isPlayingReply: boolean;
  aiVolume: number;
  communicationMode: CommunicationMode;
  isTextSending: boolean;
  onStartRecording: () => Promise<boolean>;
  onStopRecording: () => void | Promise<void>;
  onToggleMicrophone: () => void;
  onToggleSpeaker: () => void;
  onHangUp: () => void | Promise<void>;
  onStopReply: () => void;
  onAiVolumeChange: (volume: number) => void;
  onCommunicationModeChange: (mode: CommunicationMode) => void;
  onSendText: (text: string) => Promise<boolean>;
}

function getStatusText(
  disabled: boolean,
  status: VoiceInputStatus,
) {
  if (disabled) return "先选择一首音乐";
  if (status === "requesting_permission") return "正在连接麦克风…";
  if (status === "recording") return "再次点击发送";
  if (status === "sending") return "AI 正在思考；点击麦克风可以打断";
  if (status === "speaking") return "AI 正在回应；点击麦克风可以打断";
  return "点击麦克风开始说话";
}

export default function UserReplyBox({
  disabled,
  status,
  error,
  inputDeviceLabel,
  isMicrophoneMuted,
  musicContinuesWhenMicrophoneMuted,
  isSpeakerMuted,
  isCallConnected,
  isPlayingReply,
  aiVolume,
  communicationMode,
  isTextSending,
  onStartRecording,
  onStopRecording,
  onToggleMicrophone,
  onToggleSpeaker,
  onHangUp,
  onStopReply,
  onAiVolumeChange,
  onCommunicationModeChange,
  onSendText,
}: UserReplyBoxProps) {
  const [textDraft, setTextDraft] = useState("");
  const [isPressing, setIsPressing] = useState(false);
  const gestureActiveRef = useRef(false);
  const startPendingRef = useRef(false);
  const recorderStartedRef = useRef(false);
  const finishInFlightRef = useRef(false);
  const isRecording = status === "recording";

  const handleTextSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = textDraft.trim();
    if (!text || disabled || isTextSending) return;
    void onSendText(text).then((sent) => {
      if (sent) setTextDraft("");
    });
  };

  const finishRecording = () => {
    if (
      !recorderStartedRef.current ||
      finishInFlightRef.current
    ) {
      return;
    }

    finishInFlightRef.current = true;
    void Promise.resolve(onStopRecording()).finally(() => {
      recorderStartedRef.current = false;
      finishInFlightRef.current = false;
    });
  };

  const beginRecording = () => {
    if (
      gestureActiveRef.current ||
      startPendingRef.current ||
      finishInFlightRef.current ||
      disabled ||
      isMicrophoneMuted
    ) {
      return;
    }

    gestureActiveRef.current = true;
    startPendingRef.current = true;
    recorderStartedRef.current = false;
    setIsPressing(true);

    void onStartRecording().then((started) => {
      startPendingRef.current = false;
      recorderStartedRef.current = started;
      if (!started) {
        gestureActiveRef.current = false;
        setIsPressing(false);
        return;
      }
      if (!gestureActiveRef.current) finishRecording();
    });
  };

  const endRecording = () => {
    if (!gestureActiveRef.current) return;

    gestureActiveRef.current = false;
    setIsPressing(false);
    finishRecording();
  };

  const toggleRecording = () => {
    const action = getTapRecordingAction(
      gestureActiveRef.current,
      status,
      startPendingRef.current,
    );

    if (action === "stop") {
      endRecording();
      return;
    }

    if (gestureActiveRef.current) {
      // The browser may have killed a mobile stream in the background.
      // Clear that stale UI gesture and reconnect on this same tap.
      gestureActiveRef.current = false;
      recorderStartedRef.current = false;
      setIsPressing(false);
    }
    beginRecording();
  };

  const handlePointerDown = (
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    toggleRecording();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      (event.key !== " " && event.key !== "Enter") ||
      event.repeat
    ) {
      return;
    }
    event.preventDefault();
    toggleRecording();
  };

  return (
    <section className="reply-box voice-call-box" aria-labelledby="voice-reply-label">
      <div className="voice-call-heading">
        <span className={`voice-call-presence ${!isMicrophoneMuted && (isRecording || isPlayingReply) ? "voice-call-presence-active" : ""}`} />
        <p id="voice-reply-label" className="reply-label">
          {communicationMode === "voice" ? "语音陪听" : "文字陪听"}
        </p>
      </div>

      <div className="communication-mode-options" role="group" aria-label="选择与 AI 的沟通方式">
        <button
          type="button"
          className={communicationMode === "voice" ? "communication-mode-active" : ""}
          aria-pressed={communicationMode === "voice"}
          onClick={() => onCommunicationModeChange("voice")}
        >
          语音沟通
        </button>
        <button
          type="button"
          className={communicationMode === "text" ? "communication-mode-active" : ""}
          aria-pressed={communicationMode === "text"}
          onClick={() => onCommunicationModeChange("text")}
        >
          打字聊天
        </button>
      </div>

      {communicationMode === "text" && (
        <form className="text-reply-form" onSubmit={handleTextSubmit}>
          <textarea
            value={textDraft}
            rows={2}
            maxLength={500}
            disabled={disabled || isTextSending}
            aria-label="输入要对 AI 说的话"
            placeholder={disabled ? "先选择一首音乐" : "输入想对 AI 说的话…"}
            onChange={(event) => setTextDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            disabled={disabled || isTextSending || !textDraft.trim()}
          >
            {isTextSending ? "发送中…" : "发送"}
          </button>
        </form>
      )}

      <div hidden={communicationMode === "text"} className={`voice-call-stage ${isRecording && !isMicrophoneMuted ? "voice-call-stage-listening" : ""} ${isPlayingReply ? "voice-call-stage-speaking" : ""}`}>
        <span className="voice-call-ring voice-call-ring-one" aria-hidden="true" />
        <span className="voice-call-ring voice-call-ring-two" aria-hidden="true" />

        <button
          className={`voice-record-button${
            isRecording ? " voice-record-button-active" : ""
          }`}
          type="button"
          disabled={disabled || isMicrophoneMuted}
          aria-pressed={isPressing}
          aria-label="点击开始说话，再次点击发送"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
        >
          <span className="voice-mic-icon" aria-hidden="true">
            {isRecording ? "■" : "●"}
          </span>
        </button>
      </div>

      <p className="voice-record-status" aria-live="polite">
        {communicationMode === "text"
          ? disabled
            ? "先选择音乐，之后可以直接打字"
            : isTextSending
              ? "AI 正在用文字回复…"
              : "文字模式不会播放 AI 语音"
          : isMicrophoneMuted
          ? musicContinuesWhenMicrophoneMuted
            ? "麦克风已关闭，AI 仍在听音乐，但听不到你说话"
            : "麦克风已关闭，AI 听不到其他设备外放和你的声音"
          : !isCallConnected && !disabled
            ? "通话已挂断，按主按钮重新连接"
            : getStatusText(disabled, status)}
      </p>

      <div hidden={communicationMode === "text"} className="voice-call-controls" aria-label="通话控制">
        <div className="voice-call-control-item">
          <button
            type="button"
            className={`voice-call-control-button${isSpeakerMuted ? " voice-call-control-button-muted" : ""}`}
            aria-label={isSpeakerMuted ? "打开扬声器" : "关闭扬声器"}
            aria-pressed={!isSpeakerMuted}
            onClick={onToggleSpeaker}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2-4.03v8.06A4.5 4.5 0 0 0 16.5 12Zm0-8.48v2.06a7 7 0 0 1 0 12.84v2.06a9 9 0 0 0 0-16.96Z" />
            </svg>
          </button>
          <span>{isSpeakerMuted ? "扬声器关" : "扬声器"}</span>
        </div>

        <div className="voice-call-control-item">
          <button
            type="button"
            className={`voice-call-control-button${isMicrophoneMuted ? " voice-call-control-button-muted" : ""}`}
            aria-label={isMicrophoneMuted ? "打开麦克风" : "关闭麦克风"}
            aria-pressed={!isMicrophoneMuted}
            onClick={onToggleMicrophone}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2Z" />
              {isMicrophoneMuted && <path d="m4.7 3.3 16 16-1.4 1.4-16-16 1.4-1.4Z" />}
            </svg>
          </button>
          <span>{isMicrophoneMuted ? "麦克风关" : "麦克风"}</span>
        </div>

        <div className="voice-call-control-item">
          <button
            type="button"
            className="voice-call-control-button voice-call-control-button-hangup"
            disabled={!isCallConnected}
            aria-label="挂断语音通话"
            onClick={() => void onHangUp()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.2 15.8c4.8-4.4 10.8-4.4 15.6 0l-2.7 3.1-3.2-2v-2.1a11.8 11.8 0 0 0-3.8 0v2.1l-3.2 2-2.7-3.1Z" />
            </svg>
          </button>
          <span>挂断</span>
        </div>
      </div>

      <div hidden={communicationMode === "text"} className="ai-volume-control">
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

      {communicationMode === "voice" && inputDeviceLabel && (
        <p className="voice-record-status">
          当前麦克风：{inputDeviceLabel}
        </p>
      )}

      {communicationMode === "voice" && isPlayingReply && (
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
