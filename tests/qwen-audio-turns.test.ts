import { afterEach, describe, expect, it } from "vitest";

import {
  QWEN_AUDIO_CHUNK_BASE64_LENGTH,
  QwenRealtimeClient,
} from "@/lib/qwen/realtimeClient";

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  listeners = new Map<string, ((event: { data: string }) => void)[]>();

  addEventListener(
    type: string,
    listener: (event: { data: string }) => void,
  ) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(value: string) {
    this.sent.push(value);
  }

  close() {}

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  message(event: unknown) {
    this.emit("message", { data: JSON.stringify(event) });
  }

  events() {
    return this.sent.map((value) => JSON.parse(value));
  }

  private emit(type: string, event: { data?: string }) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: event.data ?? "" });
    }
  }
}

function createReadyClient() {
  const holder: { current: FakeWebSocket | null } = {
    current: null,
  };

  globalThis.WebSocket = class extends FakeWebSocket {
    constructor() {
      super();
      holder.current = this;
    }
  } as unknown as typeof WebSocket;

  const client = new QwenRealtimeClient({
    url: "ws://test",
  });
  client.connect();
  const socket = holder.current;

  if (!socket) throw new Error("Fake WebSocket was not created");
  socket.open();
  socket.message({ type: "session.updated" });

  return { client, socket };
}

describe("Qwen audio turns", () => {
  const originalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("keeps spoken output enabled for automatic music listening", () => {
    const { client, socket } = createReadyClient();

    expect(client.sendMusicMessage("song", "listen")).toBe(true);

    const sessionUpdate = socket
      .events()
      .findLast((event) => event.type === "session.update");
    expect(sessionUpdate.session.input_audio_transcription).toBeNull();

    expect(socket.events().at(-1)).toEqual({
      type: "response.create",
      response: { modalities: ["text", "audio"] },
    });
  });

  it("enables transcription only for microphone voice", () => {
    const { client, socket } = createReadyClient();

    expect(
      client.sendVoiceMessage("user-voice", "listen and answer"),
    ).toBe(true);

    const sessionUpdate = socket
      .events()
      .findLast((event) => event.type === "session.update");
    expect(sessionUpdate.session.input_audio_transcription).toEqual({
      model: "qwen3-asr-flash-realtime",
    });
  });

  it("splits audio into frames safely below Qwen's limit", () => {
    const { client, socket } = createReadyClient();
    const audio = "A".repeat(
      QWEN_AUDIO_CHUNK_BASE64_LENGTH * 2 + 8,
    );

    expect(client.sendMusicMessage(audio, "listen")).toBe(true);

    const chunks = socket
      .events()
      .filter(
        (event) => event.type === "input_audio_buffer.append",
      )
      .map((event) => event.audio as string);

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.length)).toEqual([
      QWEN_AUDIO_CHUNK_BASE64_LENGTH,
      QWEN_AUDIO_CHUNK_BASE64_LENGTH,
      8,
    ]);
    expect(chunks.join("")).toBe(audio);
    expect(
      Math.max(
        ...chunks.map(
          (chunk) =>
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: chunk,
            }).length,
        ),
      ),
    ).toBeLessThan(262_144);
  });

});
