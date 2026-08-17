"use client";

import {
  useCallback,
  useState,
} from "react";

import { calculateBandShares } from "@/lib/audio/spectrum";
import type {
  LocalAudioFeatures,
} from "@/types/music";

type LocalFeatureStatus =
  | "idle"
  | "analyzing"
  | "success"
  | "error";

function createEmptyFeatures(
  note: string,
): LocalAudioFeatures {
  return {
    durationSeconds: null,
    sampleRate: null,
    channels: null,
    rms: null,
    averageAmplitude: null,
    zeroCrossingRate: null,
    volumeMoments: [],
    energyLabel: "未知",
    brightnessLabel: "未知",
    motionLabel: "未知",
    styleHint: "未知",
    analysisNote: note,
  };
}

function getEnergyLabel(
  rms: number | null,
): string {
  if (typeof rms !== "number") {
    return "未知";
  }

  if (rms < 0.025) {
    return "整体比较轻";
  }

  if (rms < 0.055) {
    return "整体不算吵";
  }

  if (rms < 0.12) {
    return "整体刚刚好";
  }

  return "整体比较响";
}

function getBrightnessLabel(
  zeroCrossingRate: number | null,
): string {
  if (typeof zeroCrossingRate !== "number") {
    return "未知";
  }

  if (zeroCrossingRate < 0.025) {
    return "听起来比较闷一点";
  }

  if (zeroCrossingRate < 0.065) {
    return "听起来比较正常";
  }

  return "听起来比较清、比较尖一点";
}

function getMotionLabel(
  zeroCrossingRate: number | null,
  averageAmplitude: number | null,
): string {
  if (
    typeof zeroCrossingRate !== "number" ||
    typeof averageAmplitude !== "number"
  ) {
    return "未知";
  }

  if (
    zeroCrossingRate < 0.025 &&
    averageAmplitude < 0.035
  ) {
    return "变化比较少";
  }

  if (zeroCrossingRate < 0.06) {
    return "有一点起伏";
  }

  return "变化比较多";
}

function getStyleHint({
  rms,
  zeroCrossingRate,
}: {
  rms: number | null;
  zeroCrossingRate: number | null;
}): string {
  if (
    typeof rms !== "number" ||
    typeof zeroCrossingRate !== "number"
  ) {
    return "暂时无法判断";
  }

  if (rms < 0.03 && zeroCrossingRate < 0.03) {
    return "整体声音轻，变化少";
  }

  if (rms < 0.06 && zeroCrossingRate < 0.06) {
    return "整体声音偏轻，有少量起伏";
  }

  if (rms >= 0.12 && zeroCrossingRate >= 0.06) {
    return "整体声音较满，变化较明显";
  }

  if (zeroCrossingRate >= 0.08) {
    return "局部变化较明显";
  }

  return "整体较平稳";
}

function calculateVolumeMoments({
  samples,
  sampleRate,
  durationSeconds,
}: {
  samples: Float32Array;
  sampleRate: number;
  durationSeconds: number;
}) {
  const windowSeconds = 1;
  const maxSeconds = Math.min(
    Math.ceil(durationSeconds),
    600,
  );
  const windowLength = Math.max(
    1,
    Math.floor(sampleRate * windowSeconds),
  );
  const moments: {
    timeSeconds: number;
    rms: number;
    lowBassShare: number | null;
    upperMidShare: number | null;
  }[] = [];

  for (
    let second = 0;
    second < maxSeconds;
    second += 1
  ) {
    const start = second * sampleRate;
    const end = Math.min(
      samples.length,
      start + windowLength,
    );

    if (start >= end) {
      break;
    }

    let squareSum = 0;
    let count = 0;

    for (let index = start; index < end; index += 1) {
      const sample = samples[index];

      if (!Number.isFinite(sample)) {
        continue;
      }

      squareSum += sample * sample;
      count += 1;
    }

    moments.push({
      timeSeconds: second,
      rms: count > 0 ? Math.sqrt(squareSum / count) : 0,
      ...calculateBandShares({
        samples,
        sampleRate,
        start,
        end,
      }),
    });
  }

  return moments;
}

function calculateFeatures(
  audioBuffer: AudioBuffer,
): LocalAudioFeatures {
  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const durationSeconds = audioBuffer.duration;

  const firstChannel =
    audioBuffer.getChannelData(0);

  const maxSamples = Math.min(
    firstChannel.length,
    sampleRate * 60,
  );

  const stride = Math.max(
    1,
    Math.floor(maxSamples / 240000),
  );

  let squareSum = 0;
  let absoluteSum = 0;
  let zeroCrossings = 0;
  let previousSample = 0;
  let usableSamples = 0;

  for (
    let index = 0;
    index < maxSamples;
    index += stride
  ) {
    const sample = firstChannel[index];

    if (!Number.isFinite(sample)) {
      continue;
    }

    squareSum += sample * sample;
    absoluteSum += Math.abs(sample);

    if (
      usableSamples > 0 &&
      ((previousSample >= 0 && sample < 0) ||
        (previousSample < 0 && sample >= 0))
    ) {
      zeroCrossings += 1;
    }

    previousSample = sample;
    usableSamples += 1;
  }

  if (usableSamples <= 0) {
    return createEmptyFeatures(
      "浏览器读取到了音频，但没有拿到可分析的采样数据。",
    );
  }

  const rms = Math.sqrt(squareSum / usableSamples);
  const averageAmplitude =
    absoluteSum / usableSamples;
  const zeroCrossingRate =
    zeroCrossings / usableSamples;
  const volumeMoments = calculateVolumeMoments({
    samples: firstChannel,
    sampleRate,
    durationSeconds,
  });

  const energyLabel = getEnergyLabel(rms);
  const brightnessLabel =
    getBrightnessLabel(zeroCrossingRate);
  const motionLabel = getMotionLabel(
    zeroCrossingRate,
    averageAmplitude,
  );

  return {
    durationSeconds,
    sampleRate,
    channels,
    rms,
    averageAmplitude,
    zeroCrossingRate,
    volumeMoments,
    energyLabel,
    brightnessLabel,
    motionLabel,
    styleHint: getStyleHint({
      rms,
      zeroCrossingRate,
    }),
    analysisNote:
      "这是浏览器本地 Web Audio 分析结果，只适合给普通陪听反应做参考；不能准确识别歌名、歌词或具体乐器。",
  };
}

export function useLocalAudioFeatures() {
  const [
    status,
    setStatus,
  ] = useState<LocalFeatureStatus>("idle");

  const [
    features,
    setFeatures,
  ] = useState<LocalAudioFeatures | null>(
    null,
  );

  const [
    error,
    setError,
  ] = useState("");

  const reset = useCallback(() => {
    setStatus("idle");
    setFeatures(null);
    setError("");
  }, []);

  const analyzeFile = useCallback(
    async (file: File) => {
      setStatus("analyzing");
      setError("");

      try {
        const arrayBuffer =
          await file.arrayBuffer();

        const AudioContextClass =
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;

        if (!AudioContextClass) {
          throw new Error(
            "当前浏览器不支持 AudioContext。",
          );
        }

        const audioContext =
          new AudioContextClass();

        const audioBuffer =
          await audioContext.decodeAudioData(
            arrayBuffer.slice(0),
          );

        const nextFeatures =
          calculateFeatures(audioBuffer);

        setFeatures(nextFeatures);
        setStatus("success");

        await audioContext.close();

        return nextFeatures;
      } catch (unknownError) {
        const message =
          unknownError instanceof Error
            ? unknownError.message
            : "本地音频分析失败。";

        setError(message);
        setStatus("error");

        const fallback =
          createEmptyFeatures(message);

        setFeatures(fallback);

        return fallback;
      }
    },
    [],
  );

  return {
    status,
    features,
    error,
    analyzeFile,
    reset,
  };
}
