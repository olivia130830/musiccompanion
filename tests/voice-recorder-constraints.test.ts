import { describe, expect, it } from "vitest";

import {
  choosePreferredMicrophone,
  getRecorderOptions,
  getVoiceAudioConstraints,
  isLikelySystemAudioInput,
} from "@/hooks/useVoiceRecorder";

describe("getVoiceAudioConstraints", () => {
  it("always requests microphone speech cleanup", () => {
    expect(getVoiceAudioConstraints({})).toMatchObject({
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  it("enables optional voice isolation when the browser supports it", () => {
    expect(
      getVoiceAudioConstraints({
        voiceIsolation: true,
        suppressLocalAudioPlayback: true,
      }),
    ).toMatchObject({
      voiceIsolation: true,
      suppressLocalAudioPlayback: true,
    });
  });
});

describe("getRecorderOptions", () => {
  it("keeps enough speech detail for transcription", () => {
    const originalMediaRecorder = globalThis.MediaRecorder;
    globalThis.MediaRecorder = {
      isTypeSupported: () => true,
    } as unknown as typeof MediaRecorder;

    try {
      expect(getRecorderOptions()).toMatchObject({
        audioBitsPerSecond: 128_000,
      });
    } finally {
      globalThis.MediaRecorder = originalMediaRecorder;
    }
  });
});

describe("microphone selection", () => {
  it("recognizes common system-audio loopback devices", () => {
    expect(isLikelySystemAudioInput("BlackHole 2ch")).toBe(true);
    expect(isLikelySystemAudioInput("立体声混音")).toBe(true);
    expect(isLikelySystemAudioInput("MacBook Pro Microphone")).toBe(false);
  });

  it("prefers a physical microphone over a loopback input", () => {
    expect(
      choosePreferredMicrophone([
        {
          kind: "audioinput",
          deviceId: "loopback",
          label: "BlackHole 2ch",
        },
        {
          kind: "audioinput",
          deviceId: "mic",
          label: "MacBook Pro Microphone",
        },
      ]),
    ).toMatchObject({ deviceId: "mic" });
  });
});
