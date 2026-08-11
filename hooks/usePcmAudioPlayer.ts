"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const QWEN_OUTPUT_SAMPLE_RATE = 24000;

export function pcm16Base64ToFloat32(audioBase64: string) {
  const binary = atob(audioBase64);
  const sampleCount = Math.floor(binary.length / 2);
  const samples = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    const lowByte = binary.charCodeAt(index * 2);
    const highByte = binary.charCodeAt(index * 2 + 1);
    let pcm16 = lowByte | (highByte << 8);

    if (pcm16 >= 0x8000) pcm16 -= 0x10000;
    samples[index] = pcm16 < 0 ? pcm16 / 0x8000 : pcm16 / 0x7fff;
  }

  return samples;
}

export function usePcmAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const volumeRef = useRef(1);
  const contextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartTimeRef = useRef(0);
  const streamDoneRef = useRef(true);
  const suppressAudioRef = useRef(false);

  const getContext = useCallback(() => {
    if (!contextRef.current) {
      const AudioContextConstructor =
        window.AudioContext ??
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

      if (!AudioContextConstructor) {
        throw new Error("当前浏览器无法播放 AI 语音。");
      }

      contextRef.current = new AudioContextConstructor();
    }

    return contextRef.current;
  }, []);

  const getGain = useCallback((context: AudioContext) => {
    if (!gainRef.current) {
      const gain = context.createGain();
      gain.gain.value = volumeRef.current;
      gain.connect(context.destination);
      gainRef.current = gain;
    }

    return gainRef.current;
  }, []);

  const setVolume = useCallback((nextVolume: number) => {
    const normalizedVolume = Math.min(1, Math.max(0, nextVolume));

    volumeRef.current = normalizedVolume;
    setVolumeState(normalizedVolume);

    const context = contextRef.current;
    const gain = gainRef.current;
    if (context && gain) {
      gain.gain.setValueAtTime(normalizedVolume, context.currentTime);
    }
  }, []);

  const prepare = useCallback(async () => {
    const context = getContext();
    if (context.state === "suspended") await context.resume();
  }, [getContext]);

  const stop = useCallback(() => {
    for (const source of sourcesRef.current) {
      try {
        source.stop();
      } catch {}
    }

    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    streamDoneRef.current = true;
    suppressAudioRef.current = true;
    setIsPlaying(false);
  }, []);

  const begin = useCallback(() => {
    suppressAudioRef.current = false;
  }, []);

  const append = useCallback(
    (audioBase64: string) => {
      if (suppressAudioRef.current) return;

      const samples = pcm16Base64ToFloat32(audioBase64);
      if (!samples.length) return;

      const context = getContext();
      if (context.state === "suspended") void context.resume();

      const buffer = context.createBuffer(
        1,
        samples.length,
        QWEN_OUTPUT_SAMPLE_RATE,
      );
      buffer.copyToChannel(samples, 0);

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(getGain(context));

      const startTime = Math.max(
        context.currentTime + 0.02,
        nextStartTimeRef.current,
      );
      nextStartTimeRef.current = startTime + buffer.duration;
      streamDoneRef.current = false;
      sourcesRef.current.add(source);
      setIsPlaying(true);

      source.addEventListener("ended", () => {
        sourcesRef.current.delete(source);
        if (streamDoneRef.current && sourcesRef.current.size === 0) {
          nextStartTimeRef.current = 0;
          setIsPlaying(false);
        }
      });
      source.start(startTime);
    },
    [getContext, getGain],
  );

  const finish = useCallback(() => {
    streamDoneRef.current = true;
    suppressAudioRef.current = false;
    if (sourcesRef.current.size === 0) {
      nextStartTimeRef.current = 0;
      setIsPlaying(false);
    }
  }, []);

  useEffect(
    () => () => {
      for (const source of sourcesRef.current) {
        try {
          source.stop();
        } catch {}
      }
      sourcesRef.current.clear();
      gainRef.current?.disconnect();
      gainRef.current = null;
      void contextRef.current?.close();
      contextRef.current = null;
    },
    [],
  );

  return {
    isPlaying,
    volume,
    setVolume,
    prepare,
    begin,
    append,
    finish,
    stop,
  };
}
