"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

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
  onStartRecording: () => Promise<boolean>;
  onStopRecording: () => void | Promise<void>;
  onCancelRecording: () => void | Promise<void>;
  onStopReply: () => void;
  onAiVolumeChange: (volume: number) => void;
}

const CANCEL_GESTURE_DISTANCE = 40;

export function shouldCancelVoiceGesture(
  startY: number,
  currentY: number,
) {
  return startY - currentY >= CANCEL_GESTURE_DISTANCE;
}

function getStatusText(
  disabled: boolean,
  status: VoiceInputStatus,
  isPressing: boolean,
  isCancelling: boolean,
) {
  if (disabled) return "先选择一首音乐";
  if (status === "requesting_permission") return "正在连接麦克风…";
  if (isPressing && isCancelling) return "松开取消";
  if (status === "recording") return "松开发送，上移取消";
  if (status === "sending") return "正在把这句话交给 AI…";
  if (status === "speaking") return "AI 正在回应你";
  return "按住麦克风说话";
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
  onCancelRecording,
  onStopReply,
  onAiVolumeChange,
}: UserReplyBoxProps) {
  const [isPressing, setIsPressing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const gestureActiveRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const startYRef = useRef(0);
  const startPendingRef = useRef(false);
  const recorderStartedRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const finishInFlightRef = useRef(false);
  const isRecording = status === "recording";
  const isBusy = status === "sending";

  const finishRecording = () => {
    if (
      !recorderStartedRef.current ||
      finishInFlightRef.current
    ) {
      return;
    }

    finishInFlightRef.current = true;
    const finish = cancelRequestedRef.current
      ? onCancelRecording
      : onStopRecording;
    void Promise.resolve(finish()).finally(() => {
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
      isBusy
    ) {
      return;
    }

    gestureActiveRef.current = true;
    startPendingRef.current = true;
    recorderStartedRef.current = false;
    cancelRequestedRef.current = false;
    setIsPressing(true);
    setIsCancelling(false);

    void onStartRecording().then((started) => {
      startPendingRef.current = false;
      recorderStartedRef.current = started;
      if (!started) {
        gestureActiveRef.current = false;
        pointerIdRef.current = null;
        setIsPressing(false);
        setIsCancelling(false);
        return;
      }
      if (!gestureActiveRef.current) finishRecording();
    });
  };

  const endRecording = (cancelled: boolean) => {
    if (!gestureActiveRef.current) return;

    cancelRequestedRef.current = cancelled;
    gestureActiveRef.current = false;
    pointerIdRef.current = null;
    setIsPressing(false);
    setIsCancelling(false);
    finishRecording();
  };

  const handlePointerDown = (
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0 || gestureActiveRef.current) return;
    event.preventDefault();
    pointerIdRef.current = event.pointerId;
    startYRef.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
    beginRecording();
  };

  const handlePointerMove = (
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (pointerIdRef.current !== event.pointerId) return;
    const cancelled = shouldCancelVoiceGesture(
      startYRef.current,
      event.clientY,
    );
    cancelRequestedRef.current = cancelled;
    setIsCancelling(cancelled);
  };

  const handlePointerEnd = (
    event: PointerEvent<HTMLButtonElement>,
    forceCancel = false,
  ) => {
    if (pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    endRecording(forceCancel || cancelRequestedRef.current);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      (event.key !== " " && event.key !== "Enter") ||
      event.repeat
    ) {
      return;
    }
    event.preventDefault();
    beginRecording();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    endRecording(false);
  };

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
          }${
            isCancelling ? " voice-record-button-cancelling" : ""
          }`}
          type="button"
          disabled={disabled || isBusy}
          aria-pressed={isPressing}
          aria-label="按住说话，松开发送，上移取消"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => handlePointerEnd(event)}
          onPointerCancel={(event) => handlePointerEnd(event, true)}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
        >
          <span className="voice-mic-icon" aria-hidden="true">
            {isCancelling ? "×" : isRecording ? "■" : "●"}
          </span>
        </button>
      </div>

      <p className="voice-record-status" aria-live="polite">
        {getStatusText(
          disabled,
          status,
          isPressing,
          isCancelling,
        )}
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
