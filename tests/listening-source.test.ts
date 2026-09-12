import { describe, expect, it } from "vitest";

import {
  calculateAudioRms,
  canFallbackToMicrophone,
  captureSystemAudio,
  getElectronDesktopAudioConstraints,
  getMusicMicrophoneConstraints,
  getSystemAudioCaptureOptions,
  getSystemAudioFallbackNotice,
  isElectronDesktopAudioHost,
  shouldUseMicrophoneSystemAudioFallback,
} from "@/hooks/useRealtimeListeningSource";

describe("realtime listening source constraints", () => {
  it("distinguishes silence from an audible signal", () => {
    expect(calculateAudioRms(new Float32Array(16))).toBe(0);
    expect(
      calculateAudioRms(new Float32Array([0.01, -0.01, 0.01, -0.01])),
    ).toBeCloseTo(0.01);
  });

  it("keeps environmental music unprocessed on microphone input", () => {
    expect(getMusicMicrophoneConstraints()).toMatchObject({
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
  });

  it("requests the computer audio source", () => {
    expect(getSystemAudioCaptureOptions()).toMatchObject({
      video: { displaySurface: "browser" },
      audio: true,
      systemAudio: "include",
      windowAudio: "system",
    });
  });

  it("uses microphone compatibility mode for Safari and missing APIs", () => {
    const safari =
      "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15";
    expect(shouldUseMicrophoneSystemAudioFallback(safari, true)).toBe(true);
    expect(shouldUseMicrophoneSystemAudioFallback("Unknown", false)).toBe(
      true,
    );
    expect(getSystemAudioFallbackNotice(safari)).toContain("Safari");
  });

  it("keeps direct system capture for Chromium-based Baidu browser", () => {
    const baidu =
      "Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36 BIDUBrowser/13.50.0.10";
    expect(shouldUseMicrophoneSystemAudioFallback(baidu, true)).toBe(false);
  });

  it("falls back only for unavailable APIs, not denied permission", () => {
    expect(
      canFallbackToMicrophone(
        new DOMException("Not supported", "NotSupportedError"),
      ),
    ).toBe(true);
    expect(
      canFallbackToMicrophone(
        new DOMException("Permission denied", "NotAllowedError"),
      ),
    ).toBe(false);
  });

  it("recognizes VS Code as an Electron desktop audio host", () => {
    expect(
      isElectronDesktopAudioHost(
        "Mozilla/5.0 Electron/39.0.0 Chrome/142.0.0.0 Code/1.108.0",
      ),
    ).toBe(true);
    expect(
      isElectronDesktopAudioHost(
        "Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });

  it("requests Electron desktop audio instead of a microphone", () => {
    expect(getElectronDesktopAudioConstraints()).toEqual({
      audio: {
        mandatory: {
          chromeMediaSource: "desktop",
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
        },
      },
    });
  });

  it("keeps system audio and stops the required screen track", async () => {
    const audioTrack = { stop: () => {} };
    let videoStopped = false;
    const videoTrack = {
      stop: () => {
        videoStopped = true;
      },
    };
    const stream = {
      getAudioTracks: () => [audioTrack],
      getVideoTracks: () => [videoTrack],
      getTracks: () => [audioTrack, videoTrack],
    } as unknown as MediaStream;

    await expect(
      captureSystemAudio({
        getDisplayMedia: async () => stream,
        getUserMedia: async () => stream,
      }),
    ).resolves.toBe(stream);
    expect(videoStopped).toBe(false);
  });

  it("adds Electron desktop audio when VS Code only returns video", async () => {
    let videoStopped = false;
    const videoTrack = {
      stop: () => {
        videoStopped = true;
      },
    };
    const desktopAudioTrack = { stop: () => {} };
    const tracks = [videoTrack] as unknown as MediaStreamTrack[];
    const displayStream = {
      getAudioTracks: () =>
        tracks.filter((track) => track === desktopAudioTrack),
      getVideoTracks: () => [videoTrack],
      getTracks: () => tracks,
      addTrack: (track: MediaStreamTrack) => tracks.push(track),
    } as unknown as MediaStream;
    const desktopAudioStream = {
      getAudioTracks: () => [desktopAudioTrack],
      getVideoTracks: () => [],
      getTracks: () => [desktopAudioTrack],
    } as unknown as MediaStream;

    await expect(
      captureSystemAudio(
        {
          getDisplayMedia: async () => displayStream,
          getUserMedia: async () => desktopAudioStream,
        },
        true,
      ),
    ).resolves.toBe(displayStream);
    expect(displayStream.getAudioTracks()).toEqual([desktopAudioTrack]);
    expect(videoStopped).toBe(false);
  });

  it("uses Electron desktop audio when display capture is unsupported", async () => {
    const desktopAudioTrack = { stop: () => {} };
    const desktopAudioStream = {
      getAudioTracks: () => [desktopAudioTrack],
      getVideoTracks: () => [],
      getTracks: () => [desktopAudioTrack],
    } as unknown as MediaStream;

    await expect(
      captureSystemAudio(
        {
          getDisplayMedia: async () => {
            throw new DOMException("Not supported", "NotSupportedError");
          },
          getUserMedia: async () => desktopAudioStream,
        },
        true,
      ),
    ).resolves.toBe(desktopAudioStream);
  });

  it("rejects a shared surface without an audio track", async () => {
    let stopped = false;
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [],
      getTracks: () => [
        {
          stop: () => {
            stopped = true;
          },
        },
      ],
    } as unknown as MediaStream;

    await expect(
      captureSystemAudio({
        getDisplayMedia: async () => stream,
        getUserMedia: async () => stream,
      }),
    ).rejects.toThrow("没有获得系统音频");
    expect(stopped).toBe(true);
  });
});
