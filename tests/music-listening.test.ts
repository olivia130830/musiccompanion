import { describe, expect, it } from "vitest";

import {
  getRecentMusicSegment,
  MUSIC_LISTENING_WINDOW_SECONDS,
} from "@/lib/qwen/musicListening";

describe("getRecentMusicSegment", () => {
  it("listens to the full recent window after enough playback", () => {
    expect(getRecentMusicSegment(23)).toEqual({
      startTimeSeconds: 23 - MUSIC_LISTENING_WINDOW_SECONDS,
      durationSeconds: MUSIC_LISTENING_WINDOW_SECONDS,
    });
  });

  it("never includes audio after the current playback position", () => {
    expect(getRecentMusicSegment(6)).toEqual({
      startTimeSeconds: 0,
      durationSeconds: 6,
    });
  });
});
