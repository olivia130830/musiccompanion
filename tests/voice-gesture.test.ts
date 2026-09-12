import { describe, expect, it } from "vitest";

import {
  shouldCancelVoiceGesture,
  shouldUseTapToRecord,
} from "@/components/UserReplyBox";

describe("voice recording gesture", () => {
  it("cancels only after moving upward by the gesture threshold", () => {
    expect(shouldCancelVoiceGesture(200, 161)).toBe(false);
    expect(shouldCancelVoiceGesture(200, 160)).toBe(true);
    expect(shouldCancelVoiceGesture(200, 220)).toBe(false);
  });

  it("uses tap-to-start and tap-to-send only for touch pointers", () => {
    expect(shouldUseTapToRecord("touch")).toBe(true);
    expect(shouldUseTapToRecord("mouse")).toBe(false);
    expect(shouldUseTapToRecord("pen")).toBe(false);
  });
});
