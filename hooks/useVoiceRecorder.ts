"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecorderStatus =
  | "idle"
  | "requesting_permission"
  | "recording";

export type VoiceRecording = {
  blob: Blob;
  file: File;
  previewUrl: string;
  durationSeconds: number;
};

function getRecorderOptions() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  const mimeType = candidates.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate),
  );

  return mimeType ? { mimeType } : undefined;
}

function getExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function getErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return error instanceof Error ? error.message : "无法使用麦克风。";
  }
  if (error.name === "NotAllowedError") {
    return "麦克风被浏览器或系统阻止。";
  }
  if (error.name === "NotFoundError") {
    return "没有找到可用的麦克风。";
  }
  if (error.name === "NotReadableError") {
    return "麦克风可能正被其他应用占用。";
  }
  return error.message || "无法使用麦克风。";
}

export type VoiceAudioConstraints = MediaTrackConstraints & {
  voiceIsolation?: ConstrainBoolean;
  suppressLocalAudioPlayback?: ConstrainBoolean;
};

export type VoiceSupportedConstraints =
  MediaTrackSupportedConstraints & {
    voiceIsolation?: boolean;
    suppressLocalAudioPlayback?: boolean;
  };

const SYSTEM_AUDIO_INPUT_PATTERN =
  /blackhole|soundflower|loopback|vb[ -]?audio|cable (input|output)|stereo mix|what u hear|system audio|system sound|screen capture|aggregate device|系统音频|系统声音|立体声混音|聚合设备/i;

const MICROPHONE_PREFERENCE_PATTERN =
  /microphone|mic\b|麦克风|话筒|内建|内置|built[ -]?in|macbook/i;

export function isLikelySystemAudioInput(label: string) {
  return SYSTEM_AUDIO_INPUT_PATTERN.test(label.trim());
}

export function choosePreferredMicrophone(
  devices: Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">[],
) {
  const physicalInputs = devices.filter(
    (device) =>
      device.kind === "audioinput" &&
      device.deviceId &&
      !isLikelySystemAudioInput(device.label),
  );

  return (
    physicalInputs.find((device) =>
      MICROPHONE_PREFERENCE_PATTERN.test(device.label),
    ) ?? physicalInputs[0] ?? null
  );
}

export function getVoiceAudioConstraints(
  supportedConstraints: VoiceSupportedConstraints,
): VoiceAudioConstraints {
  return {
    channelCount: 1,
    sampleRate: { ideal: 16000 },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(supportedConstraints.voiceIsolation
      ? { voiceIsolation: true }
      : {}),
    ...(supportedConstraints.suppressLocalAudioPlayback
      ? { suppressLocalAudioPlayback: true }
      : {}),
  };
}

export function useVoiceRecorder() {
  const [status, setStatus] =
    useState<VoiceRecorderStatus>("idle");
  const [recording, setRecording] =
    useState<VoiceRecording | null>(null);
  const [error, setError] = useState("");
  const [inputDeviceLabel, setInputDeviceLabel] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewUrlRef = useRef("");
  const startedAtRef = useRef(0);

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const clearRecording = useCallback(() => {
    revokePreview();
    setRecording(null);
  }, [revokePreview]);

  const startRecording = useCallback(async () => {
    if (status !== "idle") return false;
    if (!window.isSecureContext) {
      throw new Error("麦克风录音需要 localhost 或 HTTPS 页面。");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前环境没有提供麦克风接口。");
    }
    if (typeof MediaRecorder === "undefined") {
      throw new Error("当前浏览器不支持 MediaRecorder。");
    }

    setStatus("requesting_permission");
    setError("");
    clearRecording();

    try {
      const constraints = getVoiceAudioConstraints(
        navigator.mediaDevices.getSupportedConstraints(),
      );
      let stream = await navigator.mediaDevices.getUserMedia({
        audio: constraints,
      });
      let audioTrack = stream.getAudioTracks()[0];

      if (
        audioTrack &&
        isLikelySystemAudioInput(audioTrack.label)
      ) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const microphone = choosePreferredMicrophone(devices);

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

      setInputDeviceLabel(audioTrack.label || "默认麦克风");
      const recorder = new MediaRecorder(stream, getRecorderOptions());

      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start(250);
      startedAtRef.current = performance.now();
      setStatus("recording");
      return true;
    } catch (unknownError) {
      releaseStream();
      setStatus("idle");
      const message = getErrorMessage(unknownError);
      setError(message);
      throw new Error(message);
    }
  }, [clearRecording, releaseStream, status]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return Promise.reject(new Error("当前没有正在进行的录音。"));
    }

    return new Promise<VoiceRecording>((resolve, reject) => {
      recorder.addEventListener(
        "stop",
        () => {
          try {
            const mimeType =
              recorder.mimeType ||
              chunksRef.current[0]?.type ||
              "audio/webm";
            const blob = new Blob(chunksRef.current, { type: mimeType });
            if (!blob.size) throw new Error("没有录到可用的声音。");

            const file = new File(
              [blob],
              `voice-comment.${getExtension(mimeType)}`,
              { type: mimeType },
            );
            const previewUrl = URL.createObjectURL(blob);
            const result = {
              blob,
              file,
              previewUrl,
              durationSeconds: Math.max(
                0.1,
                (performance.now() - startedAtRef.current) / 1000,
              ),
            };

            previewUrlRef.current = previewUrl;
            setRecording(result);
            resolve(result);
          } catch (unknownError) {
            reject(unknownError);
          } finally {
            chunksRef.current = [];
            releaseStream();
            setStatus("idle");
          }
        },
        { once: true },
      );
      recorder.stop();
    });
  }, [releaseStream]);

  useEffect(
    () => () => {
      releaseStream();
      revokePreview();
    },
    [releaseStream, revokePreview],
  );

  return {
    status,
    recording,
    error,
    inputDeviceLabel,
    startRecording,
    stopRecording,
    clearRecording,
  };
}
