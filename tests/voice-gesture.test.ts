import { describe, expect, it } from "vitest";

import { shouldCancelVoiceGesture } from "@/components/UserReplyBox";

describe("voice recording gesture", () => {
  it("cancels only after moving upward by the gesture threshold", () => {
    expect(shouldCancelVoiceGesture(200, 161)).toBe(false);
    expect(shouldCancelVoiceGesture(200, 160)).toBe(true);
    expect(shouldCancelVoiceGesture(200, 220)).toBe(false);
  });
});
