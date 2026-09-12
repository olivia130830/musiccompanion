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

  it("commits current music together with a typed lyric question", () => {
    const { client, socket } = createReadyClient();

    expect(client.appendMusicAudio("current-song")).toBe(true);
    expect(
      client.sendTextMessage(
        "刚才唱了什么？",
        "直接回答歌词",
        false,
        true,
      ),
    ).toBe(true);

    const events = socket.events();
    const commitIndex = events.findIndex(
      (event) => event.type === "input_audio_buffer.commit",
    );
    const textIndex = events.findIndex(
      (event) => event.type === "conversation.item.create",
    );
    const responseIndex = events.findIndex(
      (event) => event.type === "response.create",
    );
    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(textIndex).toBeGreaterThan(commitIndex);
    expect(responseIndex).toBeGreaterThan(textIndex);
    expect(client.getPendingMusicDurationSeconds()).toBe(0);
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

  it("commits recent music as context before a microphone turn", () => {
    const { client, socket } = createReadyClient();

    expect(client.startVoiceCall("answer the user's music question")).toBe(
      true,
    );
    socket.message({ type: "session.updated" });
    expect(client.appendMusicAudio("recent-system-music")).toBe(true);
    expect(client.commitPendingMusicContext()).toBe(true);
    expect(client.appendVoiceAudio("user-question")).toBe(true);
    expect(client.commitVoiceTurn()).toBe(true);

    const events = socket.events();
    const commits = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.type === "input_audio_buffer.commit");
    const responseIndex = events.findIndex(
      (event) => event.type === "response.create",
    );
    expect(commits).toHaveLength(2);
    expect(commits[0].index).toBeLessThan(commits[1].index);
    expect(commits[1].index).toBeLessThan(responseIndex);
  });

  it("buffers music while the remote session is still configuring", () => {
    const holder: { current: FakeWebSocket | null } = { current: null };
    globalThis.WebSocket = class extends FakeWebSocket {
      constructor() {
        super();
        holder.current = this;
      }
    } as unknown as typeof WebSocket;

    const client = new QwenRealtimeClient({ url: "ws://test" });
    client.connect();
    const socket = holder.current;
    if (!socket) throw new Error("Fake WebSocket was not created");
    socket.open();

    expect(client.appendMusicAudio("AAAA")).toBe(true);
    expect(client.getPendingMusicDurationSeconds()).toBeCloseTo(
      3 / 32000,
    );
    expect(
      socket.events().some(
        (event) => event.type === "input_audio_buffer.append",
      ),
    ).toBe(false);

    socket.message({ type: "session.updated" });
    expect(socket.events().at(-1)).toEqual({
      type: "input_audio_buffer.append",
      audio: "AAAA",
    });
    expect(client.clearInputAudio()).toBe(true);
    expect(client.getPendingMusicDurationSeconds()).toBe(0);
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

  it("commits a press-to-talk voice turn manually", () => {
    let transcriptKind: string | null = null;
    const { client, socket } = createReadyClient({
      onInputTranscriptDone: (_text, kind) => {
        transcriptKind = kind;
      },
    });

    expect(client.startVoiceCall("answer quickly")).toBe(true);
    expect(client.isReady()).toBe(false);

    const sessionUpdate = socket.events().at(-1);
    expect(sessionUpdate.session.turn_detection).toBeNull();
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
    expect(client.commitVoiceTurn()).toBe(true);
    expect(socket.events().slice(-2)).toEqual([
      { type: "input_audio_buffer.commit" },
      {
        type: "response.create",
        response: { modalities: ["text", "audio"] },
      },
    ]);
    expect(client.commitVoiceTurn()).toBe(false);

    socket.message({
      type: "input_audio_buffer.committed",
      item_id: "voice-item",
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "voice-item",
      transcript: "你好",
    });

    expect(transcriptKind).toBe("voice");
  });

  it("does not create a second response while one is active", () => {
    const { client, socket } = createReadyClient();

    expect(client.sendTextMessage("第一条")).toBe(true);
    expect(client.sendTextMessage("第二条")).toBe(false);
    expect(
      socket.events().filter((event) => event.type === "response.create"),
    ).toHaveLength(1);

    socket.message({ type: "response.done" });
    expect(client.sendTextMessage("第二条")).toBe(true);
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

    expect(client.sendTextMessage("正在回复的消息")).toBe(true);
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
