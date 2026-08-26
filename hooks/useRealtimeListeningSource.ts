"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  float32ToPcm16Base64,
  resampleMonoFloat32,
} from "@/lib/audio/pcm16";
import {
  choosePreferredMicrophone,
  isLikelySystemAudioInput,
} from "@/hooks/useVoiceRecorder";

export type LiveListeningSource = "microphone";
export type LiveListeningStatus =
  | "idle"
  | "requesting_permission"
  | "listening";

export function getMusicMicrophoneConstraints(): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

function getCaptureError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "麦克风被浏览器或系统阻止。";
  }
  if (error instanceof Error) return error.message;
  return "无法使用麦克风听音乐。";
}

export function useRealtimeListeningSource(
  onAudioChunk: (audioBase64: string) => void,
) {
  const [status, setStatus] = useState<LiveListeningStatus>("idle");
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [isMuted, setIsMutedState] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const onAudioChunkRef = useRef(onAudioChunk);
  const activeRef = useRef(false);
  const isMutedRef = useRef(false);

  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    processorRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    processorRef.current = null;
    sourceNodeRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") await context.close();
    setStatus("idle");
    setLabel("");
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    isMutedRef.current = muted;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    setIsMutedState(muted);
  }, []);

  const start = useCallback(
    async () => {
      await stop();
      if (!window.isSecureContext) {
        throw new Error("实时声音采集需要 localhost 或 HTTPS 页面。");
      }
      if (!navigator.mediaDevices) {
        throw new Error("当前环境没有提供声音采集接口。");
      }

      setStatus("requesting_permission");
      setError("");

      try {
        let stream = await navigator.mediaDevices.getUserMedia({
          audio: getMusicMicrophoneConstraints(),
        });
        let audioTrack = stream.getAudioTracks()[0];
        if (audioTrack && isLikelySystemAudioInput(audioTrack.label)) {
          const microphone = choosePreferredMicrophone(
            await navigator.mediaDevices.enumerateDevices(),
          );
          if (microphone) {
            stream.getTracks().forEach((track) => track.stop());
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                ...getMusicMicrophoneConstraints(),
                deviceId: { exact: microphone.deviceId },
              },
            });
            audioTrack = stream.getAudioTracks()[0];
          }
        }
        if (!audioTrack) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error("没有获得可用的麦克风音轨。");
        }

        const AudioContextConstructor =
          window.AudioContext ??
          (window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }).webkitAudioContext;
        if (!AudioContextConstructor) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error("当前浏览器不支持实时音频处理。");
        }

        const context = new AudioContextConstructor();
        await context.resume();
        const sourceNode = context.createMediaStreamSource(stream);
        const processor = context.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (event) => {
          if (!activeRef.current) return;
          const samples = event.inputBuffer.getChannelData(0);
          const resampled = resampleMonoFloat32(samples, context.sampleRate);
          onAudioChunkRef.current(float32ToPcm16Base64(resampled));
        };
        sourceNode.connect(processor);
        processor.connect(context.destination);

        const captureTrack = stream.getAudioTracks()[0];
        captureTrack.enabled = !isMutedRef.current;
        captureTrack.addEventListener("ended", () => void stop(), {
          once: true,
        });
        streamRef.current = stream;
        contextRef.current = context;
        sourceNodeRef.current = sourceNode;
        processorRef.current = processor;
        activeRef.current = true;
        setLabel(captureTrack.label || "默认麦克风");
        setStatus("listening");
        return true;
      } catch (unknownError) {
        await stop();
        const message = getCaptureError(unknownError);
        setError(message);
        throw new Error(message);
      }
    },
    [stop],
  );

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  return {
    status,
    error,
    label,
    isMuted,
    setMuted,
    start,
    stop,
  };
}
