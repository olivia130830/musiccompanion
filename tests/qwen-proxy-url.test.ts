import { describe, expect, it } from "vitest";

import { getDefaultProxyUrl } from "@/lib/qwen/realtimeClient";

describe("getDefaultProxyUrl", () => {
  it("uses localhost proxy locally", () => {
    expect(
      getDefaultProxyUrl({
        host: "localhost:3000",
        hostname: "localhost",
        port: "3000",
        protocol: "http:",
      }),
    ).toBe("ws://localhost:8787/qwen-realtime");
  });

  it("uses the current Vercel deployment", () => {
    expect(
      getDefaultProxyUrl({
        host: "preview.vercel.app",
        hostname: "preview.vercel.app",
        port: "",
        protocol: "https:",
      }),
    ).toBe("wss://preview.vercel.app/api/qwen-realtime");
  });
});
