import { describe, expect, it } from "vitest";

import {
  float32ToPcm16Base64,
  resampleMonoFloat32,
} from "@/lib/audio/pcm16";
import { pcm16Base64ToFloat32 } from "@/hooks/usePcmAudioPlayer";

describe("PCM16 conversion", () => {
  it("resamples to 16 kHz", () => {
    expect(
      resampleMonoFloat32(new Float32Array(48000), 48000, 16000),
    ).toHaveLength(16000);
  });

  it("encodes little-endian signed PCM16", () => {
    const base64 = float32ToPcm16Base64(
      new Float32Array([-1, 0, 1]),
    );
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    );
    const view = new DataView(bytes.buffer);

    expect(view.getInt16(0, true)).toBe(-32768);
    expect(view.getInt16(2, true)).toBe(0);
    expect(view.getInt16(4, true)).toBe(32767);
  });

  it("decodes Qwen PCM16 audio output", () => {
    const encoded = float32ToPcm16Base64(
      new Float32Array([-1, 0, 1]),
    );
    const decoded = pcm16Base64ToFloat32(encoded);

    expect(Array.from(decoded)).toEqual([-1, 0, 1]);
  });
});
