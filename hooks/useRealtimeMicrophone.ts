"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  float32ToPcm16Base64,
  resampleMonoFloat32,
} from "@/lib/audio/pcm16";
import {
  choosePreferredMicrophone,
  getVoiceAudioConstraints,
  isLikelySystemAudioInput,
  type VoiceRecorderStatus,
  type VoiceSupportedConstraints,
} from "@/hooks/useVoiceRecorder";

function getMicrophoneError(error: unknown) {
  if (!(error instanceof DOMException)) {
    return error instanceof Error ? error.message : "无法使用麦克风。";
  }
  if (error.name === "NotAllowedError") return "麦克风被浏览器或系统阻止。";
  if (error.name === "NotFoundError") return "没有找到可用的麦克风。";
  if (error.name === "NotReadableError") return "麦克风可能正被其他应用占用。";
  return error.message || "无法使用麦克风。";
}

export function useRealtimeMicrophone(
  onAudioChunk: (audioBase64: string) => void,
) {
  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [error, setError] = useState("");
  const [inputDeviceLabel, setInputDeviceLabel] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const onAudioChunkRef = useRef(onAudioChunk);
  const activeRef = useRef(false);

  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") await context.close();
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) return true;
    if (!window.isSecureContext) {
      throw new Error("麦克风录音需要 localhost 或 HTTPS 页面。");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前环境没有提供麦克风接口。");
    }

    setStatus("requesting_permission");
    setError("");

    try {
      const supported =
        navigator.mediaDevices.getSupportedConstraints() as VoiceSupportedConstraints;
      const baseConstraints = getVoiceAudioConstraints(supported);
      const constraints = supported.suppressLocalAudioPlayback
        ? { ...baseConstraints, suppressLocalAudioPlayback: false }
        : baseConstraints;
      let stream = await navigator.mediaDevices.getUserMedia({
        audio: constraints,
      });
      let audioTrack = stream.getAudioTracks()[0];

      if (audioTrack && isLikelySystemAudioInput(audioTrack.label)) {
        const microphone = choosePreferredMicrophone(
          await navigator.mediaDevices.enumerateDevices(),
        );
        if (!microphone) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error(
            `当前输入设备“${audioTrack.label}”是系统音频回环，没有找到实体麦克风。请在浏览器或系统声音设置中选择麦克风。`,
          );
        }
        stream.getTracks().forEach((track) => track.stop());
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...constraints,
            deviceId: { exact: microphone.deviceId },
          },
        });
        audioTrack = stream.getAudioTracks()[0];
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
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(1024, 1, 1);
      processor.onaudioprocess = (event) => {
        if (!activeRef.current) return;
        const samples = event.inputBuffer.getChannelData(0);
        const resampled = resampleMonoFloat32(samples, context.sampleRate);
        onAudioChunkRef.current(float32ToPcm16Base64(resampled));
      };
      source.connect(processor);
      processor.connect(context.destination);

      streamRef.current = stream;
      contextRef.current = context;
      sourceRef.current = source;
      processorRef.current = processor;
      activeRef.current = true;
      setInputDeviceLabel(audioTrack.label || "默认麦克风");
      setStatus("recording");
      return true;
    } catch (unknownError) {
      await stop();
      const message = getMicrophoneError(unknownError);
      setError(message);
      throw new Error(message);
    }
  }, [stop]);

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  return { status, error, inputDeviceLabel, start, stop };
}
