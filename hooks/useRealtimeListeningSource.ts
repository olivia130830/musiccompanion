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

export type LiveListeningSource = "system_audio" | "microphone";
export type LiveListeningStatus =
  | "idle"
  | "requesting_permission"
  | "listening";

type ExtendedDisplayMediaStreamOptions = DisplayMediaStreamOptions & {
  systemAudio?: "include" | "exclude";
  windowAudio?: "exclude" | "window" | "system";
  surfaceSwitching?: "include" | "exclude";
};

export class SystemAudioUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SystemAudioUnavailableError";
  }
}

export function calculateAudioRms(samples: Float32Array) {
  if (samples.length === 0) return 0;

  let sumOfSquares = 0;
  for (const sample of samples) {
    sumOfSquares += sample * sample;
  }
  return Math.sqrt(sumOfSquares / samples.length);
}

export function getMusicMicrophoneConstraints(): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

export function getSystemAudioCaptureOptions(): ExtendedDisplayMediaStreamOptions {
  return {
    // getDisplayMedia 规范要求同时请求屏幕画面；这是屏幕轨道，不是摄像头。
    video: true,
    audio: true,
    systemAudio: "include",
    windowAudio: "system",
    surfaceSwitching: "include",
  };
}

export function shouldUseMicrophoneSystemAudioFallback(
  userAgent: string,
  hasDisplayMedia: boolean,
) {
  const isAppleMobile = /\b(?:iPhone|iPad|iPod)\b/i.test(userAgent);
  const isSafari =
    /\bSafari\//i.test(userAgent) &&
    !/\b(?:Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|OPiOS|Firefox|FxiOS|BIDUBrowser)\//i.test(
      userAgent,
    );
  return !hasDisplayMedia || isAppleMobile || isSafari;
}

export function getSystemAudioFallbackNotice(userAgent: string) {
  const browserName = /\b(?:iPhone|iPad|iPod)\b/i.test(userAgent)
    ? "iPhone/iPad 浏览器"
    : /\bSafari\//i.test(userAgent) &&
        !/\b(?:Chrome|Chromium|CriOS|Edg|OPR|Firefox|BIDUBrowser)\//i.test(
          userAgent,
        )
      ? "Safari"
      : "当前浏览器";
  return `${browserName}暂不向网页提供系统输出音轨，已自动切换到麦克风兼容模式；请用扬声器播放音乐，不要戴耳机。`;
}

export function canFallbackToMicrophone(error: unknown) {
  return (
    error instanceof SystemAudioUnavailableError ||
    (error instanceof DOMException && error.name === "NotSupportedError") ||
    (error instanceof Error && /not supported/i.test(error.message))
  );
}

export function isElectronDesktopAudioHost(
  userAgent: string,
  referrer = "",
) {
  return (
    /\bElectron\/[\d.]+/i.test(userAgent) ||
    /\b(?:Code|VSCode)\/[\d.]+/i.test(userAgent) ||
    /^vscode-webview:/i.test(referrer)
  );
}

export function getElectronDesktopAudioConstraints(): MediaStreamConstraints {
  return {
    audio: {
      mandatory: {
        chromeMediaSource: "desktop",
      },
    } as unknown as MediaTrackConstraints,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
      },
    } as unknown as MediaTrackConstraints,
  };
}

async function captureElectronDesktopAudio(
  mediaDevices: Pick<MediaDevices, "getUserMedia">,
) {
  const desktopAudioStream = await mediaDevices.getUserMedia(
    getElectronDesktopAudioConstraints(),
  );
  if (!desktopAudioStream.getAudioTracks()[0]) {
    desktopAudioStream.getTracks().forEach((track) => track.stop());
    throw new Error("Electron 没有返回桌面音频轨道");
  }
  desktopAudioStream.getVideoTracks().forEach((track) => track.stop());
  return desktopAudioStream;
}

export async function captureSystemAudio(
  mediaDevices: Pick<MediaDevices, "getDisplayMedia" | "getUserMedia">,
  useElectronDesktopAudioFallback = false,
): Promise<MediaStream> {
  let stream: MediaStream;
  try {
    stream = await mediaDevices.getDisplayMedia(
      getSystemAudioCaptureOptions(),
    );
  } catch (displayError) {
    if (!useElectronDesktopAudioFallback) throw displayError;
    try {
      return await captureElectronDesktopAudio(mediaDevices);
    } catch (desktopAudioError) {
      const detail =
        desktopAudioError instanceof Error
          ? `：${desktopAudioError.message}`
          : "";
      throw new Error(`VS Code 无法补充桌面音频轨道${detail}`);
    }
  }

  if (
    !stream.getAudioTracks()[0] &&
    useElectronDesktopAudioFallback
  ) {
    try {
      const desktopAudioStream = await captureElectronDesktopAudio(
        mediaDevices,
      );
      const desktopAudioTrack = desktopAudioStream.getAudioTracks()[0];
      stream.addTrack(desktopAudioTrack);
      desktopAudioStream
        .getTracks()
        .filter((track) => track !== desktopAudioTrack)
        .forEach((track) => track.stop());
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      const detail = error instanceof Error ? `：${error.message}` : "";
      throw new Error(`VS Code 无法补充桌面音频轨道${detail}`);
    }
  }

  if (!stream.getAudioTracks()[0]) {
    stream.getTracks().forEach((track) => track.stop());
    throw new SystemAudioUnavailableError(
      "没有获得系统音频。请选择正在播放音乐的标签页或屏幕，并勾选“共享音频”。",
    );
  }

  stream.getVideoTracks().forEach((track) => track.stop());
  return stream;
}

function getCaptureError(
  error: unknown,
  source: LiveListeningSource,
) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return source === "system_audio"
      ? "系统音频共享被取消或被浏览器阻止。"
      : "麦克风被浏览器或系统阻止。";
  }
  if (
    source === "system_audio" &&
    error instanceof Error &&
    (error.name === "NotSupportedError" ||
      /not supported/i.test(error.message))
  ) {
    return "当前浏览器或系统没有提供可用的系统音频轨道。";
  }
  if (error instanceof Error) return error.message;
  return source === "system_audio"
    ? "无法获取系统声音。"
    : "无法使用麦克风听音乐。";
}

export function useRealtimeListeningSource(
  onAudioChunk: (audioBase64: string, rms: number) => void,
) {
  const [status, setStatus] = useState<LiveListeningStatus>("idle");
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [compatibilityNotice, setCompatibilityNotice] = useState("");
  const [isMuted, setIsMutedState] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const onAudioChunkRef = useRef(onAudioChunk);
  const activeRef = useRef(false);
  const isMutedRef = useRef(false);
  const captureRequestIdRef = useRef(0);

  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  const stop = useCallback(() => {
    captureRequestIdRef.current += 1;
    activeRef.current = false;
    processorRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    processorRef.current = null;
    sourceNodeRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close();
    setStatus("idle");
    setLabel("");
    setCompatibilityNotice("");
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    isMutedRef.current = muted;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    setIsMutedState(muted);
  }, []);

  const start = useCallback(
    async (source: LiveListeningSource, initiallyMuted = false) => {
      // 系统共享必须在点击的同一个任务中发起，因此不在此前 await。
      stop();
      const captureRequestId = captureRequestIdRef.current + 1;
      captureRequestIdRef.current = captureRequestId;
      setStatus("requesting_permission");
      setError("");
      setCompatibilityNotice("");

      try {
        if (!window.isSecureContext) {
          throw new Error("实时声音采集需要 localhost 或 HTTPS 页面。");
        }
        if (!navigator.mediaDevices) {
          throw new Error("当前环境没有提供声音采集接口。");
        }

        let stream: MediaStream;
        let actualSource = source;
        let usedMicrophoneFallback = false;
        if (source === "system_audio") {
          const shouldUseFallback =
            shouldUseMicrophoneSystemAudioFallback(
              navigator.userAgent,
              Boolean(navigator.mediaDevices.getDisplayMedia),
            );
          if (shouldUseFallback) {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: getMusicMicrophoneConstraints(),
            });
            actualSource = "microphone";
            usedMicrophoneFallback = true;
          } else {
            try {
              stream = await captureSystemAudio(
                navigator.mediaDevices,
                isElectronDesktopAudioHost(
                  navigator.userAgent,
                  document.referrer,
                ),
              );
            } catch (error) {
              if (!canFallbackToMicrophone(error)) {
                throw error;
              }
              stream = await navigator.mediaDevices.getUserMedia({
                audio: getMusicMicrophoneConstraints(),
              });
              actualSource = "microphone";
              usedMicrophoneFallback = true;
            }
          }
        } else {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: getMusicMicrophoneConstraints(),
          });
        }

        if (captureRequestIdRef.current !== captureRequestId) {
          stream.getTracks().forEach((track) => track.stop());
          return false;
        }

        let audioTrack = stream.getAudioTracks()[0];
        if (
          actualSource === "microphone" &&
          audioTrack &&
          isLikelySystemAudioInput(audioTrack.label)
        ) {
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
        if (captureRequestIdRef.current !== captureRequestId) {
          stream.getTracks().forEach((track) => track.stop());
          void context.close();
          return false;
        }

        const sourceNode = context.createMediaStreamSource(stream);
        const processor = context.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (event) => {
          if (!activeRef.current) return;
          const samples = event.inputBuffer.getChannelData(0);
          const resampled = resampleMonoFloat32(samples, context.sampleRate);
          onAudioChunkRef.current(
            float32ToPcm16Base64(resampled),
            calculateAudioRms(samples),
          );
        };
        sourceNode.connect(processor);
        processor.connect(context.destination);

        isMutedRef.current =
          actualSource === "microphone" && initiallyMuted;
        setIsMutedState(isMutedRef.current);
        audioTrack.enabled = !isMutedRef.current;
        audioTrack.addEventListener("ended", stop, { once: true });
        streamRef.current = stream;
        contextRef.current = context;
        sourceNodeRef.current = sourceNode;
        processorRef.current = processor;
        activeRef.current = true;
        setLabel(
          usedMicrophoneFallback
            ? "麦克风兼容模式"
            : audioTrack.label ||
            (source === "system_audio" ? "系统声音" : "默认麦克风"),
        );
        setCompatibilityNotice(
          usedMicrophoneFallback
            ? getSystemAudioFallbackNotice(navigator.userAgent)
            : "",
        );
        setStatus("listening");
        return true;
      } catch (unknownError) {
        if (captureRequestIdRef.current !== captureRequestId) return false;
        stop();
        const message = getCaptureError(unknownError, source);
        setError(message);
        throw new Error(message);
      }
    },
    [stop],
  );

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return {
    status,
    error,
    label,
    compatibilityNotice,
    isMuted,
    setMuted,
    start,
    stop,
  };
}
