import { describe, expect, it } from "vitest";

import { calculateBandShares } from "@/lib/audio/spectrum";

const SAMPLE_RATE = 44100;
const SAMPLE_COUNT = SAMPLE_RATE;

function createSineWave(frequency: number) {
  const samples = new Float32Array(SAMPLE_COUNT);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin(
      (2 * Math.PI * frequency * index) / SAMPLE_RATE,
    );
  }

  return samples;
}

describe("calculateBandShares", () => {
  it("recognizes an 80 Hz tone as low bass", () => {
    const samples = createSineWave(80);
    const result = calculateBandShares({
      samples,
      sampleRate: SAMPLE_RATE,
      start: 0,
      end: samples.length,
    });

    expect(result.lowBassShare).not.toBeNull();
    expect(result.lowBassShare!).toBeGreaterThan(0.9);
    expect(result.upperMidShare!).toBeLessThan(0.01);
  });

  it("recognizes a 3000 Hz tone as upper-mid energy", () => {
    const samples = createSineWave(3000);
    const result = calculateBandShares({
      samples,
      sampleRate: SAMPLE_RATE,
      start: 0,
      end: samples.length,
    });

    expect(result.upperMidShare).not.toBeNull();
    expect(result.upperMidShare!).toBeGreaterThan(0.9);
    expect(result.lowBassShare!).toBeLessThan(0.01);
  });
});
