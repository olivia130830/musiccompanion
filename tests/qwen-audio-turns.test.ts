import { afterEach, describe, expect, it } from "vitest";

import {
  QWEN_AUDIO_CHUNK_BASE64_LENGTH,
  QWEN_MAX_OUTPUT_TOKENS,
  QwenRealtimeClient,
  type QwenRealtimeClientOptions,
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

function createReadyClient(options: QwenRealtimeClientOptions = {}) {
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
    ...options,
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
    expect(sessionUpdate.session.max_tokens).toBe(
      QWEN_MAX_OUTPUT_TOKENS,
    );

    expect(socket.events().at(-1)).toEqual({
      type: "response.create",
      response: { modalities: ["text", "audio"] },
    });
  });

  it("requests text-only output for typed chat", () => {
    const { client, socket } = createReadyClient();

    expect(
      client.sendTextMessage("这段旋律怎么样？", "只用文字回答", false),
    ).toBe(true);

    const events = socket.events();
    expect(
      events.findLast((event) => event.type === "session.update")
        .session.instructions,
    ).toBe("只用文字回答");
    expect(
      events.findLast(
        (event) => event.type === "conversation.item.create",
      ).item.content,
    ).toEqual([
      {
        type: "input_text",
        text: "这段旋律怎么样？",
      },
    ]);
    expect(events.at(-1)).toEqual({
      type: "response.create",
      response: { modalities: ["text"] },
    });
  });

  it("commits already-streamed live music without resending it", () => {
    const { client, socket } = createReadyClient();

    expect(client.commitMusicStream("listen live")).toBe(false);
    expect(client.appendMusicAudio("live-song")).toBe(true);
    expect(client.commitMusicStream("listen live")).toBe(true);

    const events = socket.events();
    const appendIndex = events.findIndex(
      (event) => event.type === "input_audio_buffer.append",
    );
    const sessionIndex = events.findLastIndex(
      (event) => event.type === "session.update",
    );
    const commitIndex = events.findIndex(
      (event, index) =>
        index > appendIndex &&
        event.type === "input_audio_buffer.commit",
    );
    const responseIndex = events.findIndex(
      (event, index) =>
        index > commitIndex && event.type === "response.create",
    );

    expect(appendIndex).toBeGreaterThanOrEqual(0);
    expect(sessionIndex).toBeGreaterThan(appendIndex);
    expect(commitIndex).toBeGreaterThan(sessionIndex);
    expect(responseIndex).toBeGreaterThan(commitIndex);
    expect(
      events.filter(
        (event) => event.type === "input_audio_buffer.clear",
      ),
    ).toHaveLength(0);
    expect(client.commitMusicStream("listen again")).toBe(false);
  });

  it("drops buffered live music when playback is interrupted", () => {
    const { client, socket } = createReadyClient();

    expect(client.appendMusicAudio("before-seek")).toBe(true);
    expect(client.clearInputAudio()).toBe(true);
    expect(client.commitMusicStream("must not answer")).toBe(false);
    expect(socket.events().at(-1)).toEqual({
      type: "input_audio_buffer.clear",
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

  it("streams a continuous voice call with server VAD", () => {
    let speechStarted = 0;
    let speechStopped = 0;
    let transcriptKind: string | null = null;
    const { client, socket } = createReadyClient({
      onSpeechStarted: () => {
        speechStarted += 1;
      },
      onSpeechStopped: () => {
        speechStopped += 1;
      },
      onInputTranscriptDone: (_text, kind) => {
        transcriptKind = kind;
      },
    });

    expect(client.startVoiceCall("answer quickly")).toBe(true);
    expect(client.isReady()).toBe(false);

    const sessionUpdate = socket.events().at(-1);
    expect(sessionUpdate.session.turn_detection).toEqual({
      type: "server_vad",
      threshold: 0.5,
      silence_duration_ms: 400,
    });
    expect(sessionUpdate.session.max_tokens).toBe(
      QWEN_MAX_OUTPUT_TOKENS,
    );
    expect(sessionUpdate.session.input_audio_transcription).toEqual({
      model: "qwen3-asr-flash-realtime",
    });

    socket.message({ type: "session.updated" });
    expect(client.appendVoiceAudio("live-microphone-frame")).toBe(true);
    expect(socket.events().at(-1)).toEqual({
      type: "input_audio_buffer.append",
      audio: "live-microphone-frame",
    });
    expect(
      socket.events().filter((event) => event.type === "response.create"),
    ).toHaveLength(0);

    socket.message({ type: "input_audio_buffer.speech_started" });
    socket.message({ type: "input_audio_buffer.speech_stopped" });
    socket.message({
      type: "input_audio_buffer.committed",
      item_id: "voice-item",
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "voice-item",
      transcript: "你好",
    });

    expect(speechStarted).toBe(1);
    expect(speechStopped).toBe(1);
    expect(transcriptKind).toBe("voice");
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

  it("cancels an in-flight response when playback stops", () => {
    const { client, socket } = createReadyClient();

    expect(client.cancelResponse()).toBe(true);
    expect(socket.events().at(-1)).toEqual({
      type: "response.cancel",
    });
  });

  it("keeps microphone transcription when committed item metadata is missing", () => {
    let received: { text: string; kind: string | null } | null = null;
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
      onInputTranscriptDone: (text, kind) => {
        received = { text, kind };
      },
    });
    client.connect();
    const socket = holder.current;
    if (!socket) throw new Error("Fake WebSocket was not created");
    socket.open();
    socket.message({ type: "session.updated" });
    socket.message({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "这是我的语音评论",
    });

    expect(received).toEqual({
      text: "这是我的语音评论",
      kind: "voice",
    });
  });

});
