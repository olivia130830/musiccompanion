import { describe, expect, it } from "vitest";

import { getMusicMicrophoneConstraints } from "@/hooks/useRealtimeListeningSource";

describe("realtime listening source constraints", () => {
  it("keeps environmental music unprocessed on microphone input", () => {
    expect(getMusicMicrophoneConstraints()).toMatchObject({
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
  });
});
