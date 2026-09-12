import { describe, expect, it } from "vitest";

import { getTapRecordingAction } from "@/components/UserReplyBox";

describe("tap voice recording", () => {
  it("starts on the first tap and stops on the second tap", () => {
    expect(getTapRecordingAction(false, "idle", false)).toBe("start");
    expect(getTapRecordingAction(true, "recording", false)).toBe("stop");
  });

  it("can stop while microphone permission or startup is pending", () => {
    expect(
      getTapRecordingAction(true, "requesting_permission", true),
    ).toBe("stop");
  });

  it("restarts immediately when a backgrounded stream became stale", () => {
    expect(getTapRecordingAction(true, "idle", false)).toBe("start");
  });
});
