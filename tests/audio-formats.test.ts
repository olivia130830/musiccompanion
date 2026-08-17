import { describe, expect, it } from "vitest";

import {
  AUDIO_FILE_ACCEPT,
  inferAudioMimeType,
  isSupportedAudioFile,
} from "@/lib/audio/formats";

describe("audio upload formats", () => {
  it("shows audio and video containers in the file picker", () => {
    expect(AUDIO_FILE_ACCEPT).toContain("audio/*");
    expect(AUDIO_FILE_ACCEPT).toContain("video/*");
  });

  it.each([
    ["song.mp4", "video/mp4"],
    ["song.mov", "video/quicktime"],
    ["song.m4v", "video/x-m4v"],
    ["song.aiff", "audio/aiff"],
    ["song.caf", "audio/x-caf"],
    ["song.3gp", "video/3gpp"],
  ])("accepts %s and infers %s", (name, mimeType) => {
    const file = new File(["audio"], name);

    expect(isSupportedAudioFile(file)).toBe(true);
    expect(inferAudioMimeType(file)).toBe(mimeType);
  });
});
