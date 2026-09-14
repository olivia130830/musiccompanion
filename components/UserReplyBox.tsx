"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  localizeRuntimeMessage,
  tr,
  type AppLanguage,
} from "@/lib/i18n";

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
  language: AppLanguage;
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
  language: AppLanguage,
  disabled: boolean,
  status: VoiceInputStatus,
) {
  if (disabled) return tr(language, "先选择一首音乐", "Choose a song first");
  if (status === "requesting_permission") {
    return tr(language, "正在连接麦克风…", "Connecting to the microphone…");
  }
  if (status === "recording") return tr(language, "再次点击发送", "Tap again to send");
  if (status === "sending") {
    return tr(language, "AI 正在思考；点击麦克风可以打断", "AI is thinking; tap the microphone to interrupt");
  }
  if (status === "speaking") {
    return tr(language, "AI 正在回应；点击麦克风可以打断", "AI is responding; tap the microphone to interrupt");
  }
  return tr(language, "点击麦克风开始说话", "Tap the microphone to speak");
}

export default function UserReplyBox({
  language,
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
          {communicationMode === "voice"
            ? tr(language, "语音陪听", "Voice companion")
            : tr(language, "文字陪听", "Text companion")}
        </p>
      </div>

      <div className="communication-mode-options" role="group" aria-label={tr(language, "选择与 AI 的沟通方式", "Choose how to talk with AI")}>
        <button
          type="button"
          className={communicationMode === "voice" ? "communication-mode-active" : ""}
          aria-pressed={communicationMode === "voice"}
          onClick={() => onCommunicationModeChange("voice")}
        >
          {tr(language, "语音沟通", "Voice")}
        </button>
        <button
          type="button"
          className={communicationMode === "text" ? "communication-mode-active" : ""}
          aria-pressed={communicationMode === "text"}
          onClick={() => onCommunicationModeChange("text")}
        >
          {tr(language, "打字聊天", "Text chat")}
        </button>
      </div>

      {communicationMode === "text" && (
        <form className="text-reply-form" onSubmit={handleTextSubmit}>
          <textarea
            value={textDraft}
            rows={2}
            maxLength={500}
            disabled={disabled || isTextSending}
            aria-label={tr(language, "输入要对 AI 说的话", "Message AI")}
            placeholder={disabled ? tr(language, "先选择一首音乐", "Choose a song first") : tr(language, "输入想对 AI 说的话…", "Type a message to AI…")}
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
            {isTextSending
              ? tr(language, "发送中…", "Sending…")
              : tr(language, "发送", "Send")}
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
          aria-label={tr(language, "点击开始说话，再次点击发送", "Tap to speak, then tap again to send")}
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
            ? tr(language, "先选择音乐，之后可以直接打字", "Choose a song, then type a message")
            : isTextSending
              ? tr(language, "AI 正在用文字回复…", "AI is replying in text…")
              : tr(language, "文字模式不会播放 AI 语音", "AI audio is disabled in text mode")
          : isMicrophoneMuted
          ? musicContinuesWhenMicrophoneMuted
            ? tr(language, "麦克风已关闭，AI 仍在听音乐，但听不到你说话", "Microphone off: AI can still hear the music, but not you")
            : tr(language, "麦克风已关闭，AI 听不到其他设备外放和你的声音", "Microphone off: AI cannot hear you or music from another device")
          : !isCallConnected && !disabled
            ? tr(language, "通话已挂断，按主按钮重新连接", "Call ended; tap the main button to reconnect")
            : getStatusText(language, disabled, status)}
      </p>

      <div hidden={communicationMode === "text"} className="voice-call-controls" aria-label={tr(language, "通话控制", "Call controls")}>
        <div className="voice-call-control-item">
          <button
            type="button"
            className={`voice-call-control-button${isSpeakerMuted ? " voice-call-control-button-muted" : ""}`}
            aria-label={isSpeakerMuted ? tr(language, "打开扬声器", "Turn speaker on") : tr(language, "关闭扬声器", "Turn speaker off")}
            aria-pressed={!isSpeakerMuted}
            onClick={onToggleSpeaker}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2-4.03v8.06A4.5 4.5 0 0 0 16.5 12Zm0-8.48v2.06a7 7 0 0 1 0 12.84v2.06a9 9 0 0 0 0-16.96Z" />
            </svg>
          </button>
          <span>{isSpeakerMuted ? tr(language, "扬声器关", "Speaker off") : tr(language, "扬声器", "Speaker")}</span>
        </div>

        <div className="voice-call-control-item">
          <button
            type="button"
            className={`voice-call-control-button${isMicrophoneMuted ? " voice-call-control-button-muted" : ""}`}
            aria-label={isMicrophoneMuted ? tr(language, "打开麦克风", "Turn microphone on") : tr(language, "关闭麦克风", "Turn microphone off")}
            aria-pressed={!isMicrophoneMuted}
            onClick={onToggleMicrophone}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2Z" />
              {isMicrophoneMuted && <path d="m4.7 3.3 16 16-1.4 1.4-16-16 1.4-1.4Z" />}
            </svg>
          </button>
          <span>{isMicrophoneMuted ? tr(language, "麦克风关", "Microphone off") : tr(language, "麦克风", "Microphone")}</span>
        </div>

        <div className="voice-call-control-item">
          <button
            type="button"
            className="voice-call-control-button voice-call-control-button-hangup"
            disabled={!isCallConnected}
            aria-label={tr(language, "挂断语音通话", "End voice call")}
            onClick={() => void onHangUp()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.2 15.8c4.8-4.4 10.8-4.4 15.6 0l-2.7 3.1-3.2-2v-2.1a11.8 11.8 0 0 0-3.8 0v2.1l-3.2 2-2.7-3.1Z" />
            </svg>
          </button>
          <span>{tr(language, "挂断", "End")}</span>
        </div>
      </div>

      <div hidden={communicationMode === "text"} className="ai-volume-control">
        <div className="ai-volume-heading">
          <span className="ai-volume-label">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2-4.03v8.06A4.5 4.5 0 0 0 16.5 12Zm0-8.48v2.06a7 7 0 0 1 0 12.84v2.06a9 9 0 0 0 0-16.96Z" />
            </svg>
            {tr(language, "AI 音量", "AI volume")}
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
          aria-label={tr(language, "调整 AI 回复音量", "Adjust AI response volume")}
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
          {tr(language, "当前麦克风：", "Current microphone: ")}
          {localizeRuntimeMessage(inputDeviceLabel, language)}
        </p>
      )}

      {communicationMode === "voice" && isPlayingReply && (
        <button
          type="button"
          className="voice-secondary-button"
          onClick={onStopReply}
        >
          {tr(language, "停止 AI 语音", "Stop AI voice")}
        </button>
      )}

      {error && (
        <p className="voice-record-error" role="alert">
          {localizeRuntimeMessage(error, language)}
        </p>
      )}
    </section>
  );
}
