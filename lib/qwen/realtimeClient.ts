export type QwenRealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "configured"
  | "streaming"
  | "closed"
  | "error";

export type QwenAudioInputKind = "music" | "voice";

export type QwenRealtimeClientOptions = {
  url?: string;
  onStatusChange?: (status: QwenRealtimeStatus) => void;
  onTextDelta?: (delta: string) => void;
  onTextDone?: (text: string) => void;
  onAudioStart?: () => void;
  onAudioDelta?: (audioBase64: string) => void;
  onAudioDone?: () => void;
  onResponseDone?: () => void;
  onSpeechStarted?: () => void;
  onSpeechStopped?: () => void;
  onInputTranscriptDone?: (
    text: string,
    inputKind: QwenAudioInputKind | null,
  ) => void;
  onInputTranscriptFailed?: (
    inputKind: QwenAudioInputKind | null,
  ) => void;
  onError?: (message: string) => void;
  onRawEvent?: (event: unknown) => void;
};

const LOCAL_PROXY_URL = "ws://localhost:8787/qwen-realtime";

// 千问 WebSocket 的单帧上限是 262,144 字节。Base64 音频必须按
// 4 字符边界拆分，每个 append 事件还需要为 JSON 字段预留空间。
export const QWEN_AUDIO_CHUNK_BASE64_LENGTH = 64 * 1024;

// A normal MusicCompanion reply is far below this ceiling. Keeping a generous
// server-side limit prevents an accidental runaway audio response from using
// thousands of output tokens without shortening the intended reply.
export const QWEN_MAX_OUTPUT_TOKENS = 512;

const QWEN_PCM_BYTES_PER_SECOND = 16000 * 2;
const QWEN_PRECONNECT_MUSIC_BUFFER_SECONDS = 20;

function getBase64ByteLength(value: string) {
  const paddingLength = value.endsWith("==")
    ? 2
    : value.endsWith("=")
      ? 1
      : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - paddingLength);
}

type ProxyPageLocation = Pick<
  Location,
  "host" | "hostname" | "port" | "protocol"
>;

export function getDefaultProxyUrl(
  pageLocation: ProxyPageLocation = window.location,
) {
  const isLocalPage =
    pageLocation.hostname === "localhost" ||
    pageLocation.hostname === "127.0.0.1";

  if (isLocalPage) {
    return LOCAL_PROXY_URL;
  }

  const configuredUrl =
    process.env.NEXT_PUBLIC_QWEN_REALTIME_URL;

  if (configuredUrl) {
    try {
      const url = new URL(configuredUrl);
      const isLocalUrl =
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1";
      const isAliyunEndpoint =
        url.hostname === "dashscope.aliyuncs.com" ||
        url.hostname.endsWith(".maas.aliyuncs.com");

      if (!isLocalUrl && !isAliyunEndpoint) {
        return configuredUrl;
      }
    } catch {}
  }

  if (pageLocation.port === "3000") {
    const protocol =
      pageLocation.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${pageLocation.hostname}:8787/qwen-realtime`;
  }

  const protocol =
    pageLocation.protocol === "https:" ? "wss:" : "ws:";

  return `${protocol}//${pageLocation.host}/api/qwen-realtime`;
}
const DEFAULT_INSTRUCTIONS =
  "你是 MusicCompanion，一个正在和用户一起听歌的中文伙伴。歌曲音频是你的第一手证据：默认主动辨认其中的人声、实际唱出的歌词、唱法和音乐变化，再自然回应。听到演唱时不要因为个别字不清楚就笼统声称没有清晰人声；应说出能确认的词句和听不清的部分。不得根据文件名或外部歌词补写内容。所有回复都要同时输出文字和语音。";

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}

function getEventType(event: unknown): string {
  const record = getRecord(event);

  if (!record) {
    return "";
  }

  return typeof record.type === "string" ? record.type : "";
}

function getDeltaText(event: unknown): string {
  const record = getRecord(event);

  if (!record) {
    return "";
  }

  if (typeof record.delta === "string") {
    return record.delta;
  }

  if (typeof record.text === "string") {
    return record.text;
  }

  if (typeof record.transcript === "string") {
    return record.transcript;
  }

  return "";
}

function getDoneText(event: unknown): string {
  const record = getRecord(event);

  if (!record) {
    return "";
  }

  if (typeof record.text === "string") {
    return record.text;
  }

  if (typeof record.transcript === "string") {
    return record.transcript;
  }

  return "";
}

function getErrorMessage(event: unknown): string {
  const record = getRecord(event);

  if (!record) {
    return "未知 Realtime 错误。";
  }

  if (typeof record.error === "string") {
    return record.error;
  }

  if (typeof record.reason === "string") {
    return record.reason;
  }

  if (typeof record.message === "string") {
    return record.message;
  }

  const error = getRecord(record.error);

  if (error && typeof error.message === "string") {
    return error.message;
  }

  try {
    return JSON.stringify(event);
  } catch {
    return "未知 Realtime 错误。";
  }
}

export class QwenRealtimeClient {
  private socket: WebSocket | null = null;

  private readonly options: QwenRealtimeClientOptions;

  private finalText = "";

  private isConfigured = false;

  private hasPendingStreamAudio = false;

  private hasPendingVoiceAudio = false;

  private pendingMusicAudioBytes = 0;

  private queuedMusicAudio: string[] = [];

  private queuedMusicAudioBytes = 0;

  private responseActive = false;

  private liveVoiceMode = false;

  private pendingInputKinds: QwenAudioInputKind[] = [];

  private readonly inputKindByItemId =
    new Map<string, QwenAudioInputKind>();

  public constructor(options: QwenRealtimeClientOptions = {}) {
    this.options = options;
  }

  public connect() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.options.onStatusChange?.("connecting");

    const socket = new WebSocket(
      this.options.url || getDefaultProxyUrl(),
    );
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.options.onStatusChange?.("connected");
    });

    socket.addEventListener("message", (message) => {
      this.handleMessage(message.data);
    });

    socket.addEventListener("error", () => {
      this.isConfigured = false;
      this.resetPendingAudioInputs();
      this.options.onStatusChange?.("error");
      this.options.onError?.("Realtime WebSocket 连接错误。");
    });

    socket.addEventListener("close", () => {
      this.isConfigured = false;
      this.resetPendingAudioInputs();
      this.socket = null;
      this.options.onStatusChange?.("closed");
    });
  }

  public disconnect() {
    if (!this.socket) {
      return;
    }

    this.socket.close(1000, "Client disconnected");
    this.socket = null;
    this.isConfigured = false;
    this.resetPendingAudioInputs();
    this.options.onStatusChange?.("closed");
  }

  public cancelResponse() {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      !this.responseActive
    ) {
      return false;
    }

    this.finalText = "";
    this.sendEvent({ type: "response.cancel" });
    return true;
  }

  public appendMusicAudio(audioBase64: string) {
    if (!audioBase64 || !this.socket) {
      return false;
    }

    if (!this.isReady()) {
      if (
        this.socket.readyState !== WebSocket.CONNECTING &&
        this.socket.readyState !== WebSocket.OPEN
      ) {
        return false;
      }
      this.queueMusicAudio(audioBase64);
      return true;
    }

    this.appendAudio(audioBase64);
    this.pendingMusicAudioBytes += getBase64ByteLength(audioBase64);
    this.hasPendingStreamAudio = true;
    return true;
  }

  public getPendingMusicDurationSeconds() {
    return (
      (this.pendingMusicAudioBytes + this.queuedMusicAudioBytes) /
      QWEN_PCM_BYTES_PER_SECOND
    );
  }

  public startVoiceCall(instructions: string) {
    if (!this.isReady()) return false;

    this.liveVoiceMode = true;
    this.isConfigured = false;
    // Voice turns are controlled by the press-to-talk button. Manual commit
    // avoids server VAD mistaking the song or the AI's own playback for speech.
    this.sendSessionUpdate(instructions, true, null);
    return true;
  }

  public appendVoiceAudio(audioBase64: string) {
    if (!audioBase64 || !this.liveVoiceMode || !this.isReady()) {
      return false;
    }

    this.appendAudio(audioBase64);
    this.hasPendingVoiceAudio = true;
    return true;
  }

  public commitVoiceTurn() {
    if (
      !this.isReady() ||
      !this.hasPendingVoiceAudio ||
      this.responseActive
    ) {
      return false;
    }

    this.pendingInputKinds.push("voice");
    this.sendEvent({ type: "input_audio_buffer.commit" });
    this.hasPendingVoiceAudio = false;
    this.createResponse(true);
    return true;
  }

  public clearInputAudio() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.hasPendingStreamAudio = false;
      return false;
    }

    this.sendEvent({ type: "input_audio_buffer.clear" });
    this.hasPendingStreamAudio = false;
    this.hasPendingVoiceAudio = false;
    this.pendingMusicAudioBytes = 0;
    this.queuedMusicAudio = [];
    this.queuedMusicAudioBytes = 0;
    return true;
  }

  public commitMusicStream(
    instructions: string,
    responseWithAudio = true,
  ) {
    if (
      !this.isReady() ||
      !this.hasPendingStreamAudio ||
      this.responseActive
    ) {
      return false;
    }

    this.sendSessionUpdate(instructions, false);
    this.pendingInputKinds.push("music");
    this.sendEvent({ type: "input_audio_buffer.commit" });
    this.hasPendingStreamAudio = false;
    this.pendingMusicAudioBytes = 0;
    this.createResponse(responseWithAudio);
    return true;
  }

  public isReady() {
    return (
      this.isConfigured &&
      this.socket !== null &&
      this.socket.readyState === WebSocket.OPEN
    );
  }

  public sendTextMessage(
    text: string,
    instructions = DEFAULT_INSTRUCTIONS,
    responseWithAudio = true,
  ) {
    const cleanText = text.trim();

    if (!cleanText || !this.isReady() || this.responseActive) {
      return false;
    }

    this.sendSessionUpdate(instructions, false);
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: cleanText,
          },
        ],
      },
    });

    this.finalText = "";
    this.responseActive = true;

    this.sendEvent({
      type: "response.create",
      response: {
        modalities: responseWithAudio
          ? ["text", "audio"]
          : ["text"],
      },
    });

    this.options.onStatusChange?.("streaming");
    return true;
  }

  public async waitUntilReady(timeoutMs = 10000) {
    const startedAt = Date.now();
    while (!this.isReady()) {
      if (Date.now() - startedAt >= timeoutMs) return false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return true;
  }

  public sendVoiceMessage(audioBase64: string, instructions: string) {
    return this.sendAudioMessage(
      audioBase64,
      instructions,
      "voice",
    );
  }

  public sendMusicMessage(audioBase64: string, instructions: string) {
    return this.sendAudioMessage(
      audioBase64,
      instructions,
      "music",
    );
  }

  private sendAudioMessage(
    audioBase64: string,
    instructions: string,
    inputKind: QwenAudioInputKind,
  ) {
    if (!audioBase64 || !this.isReady() || this.responseActive) {
      return false;
    }

    this.sendSessionUpdate(instructions, inputKind === "voice");
    this.commitAudioInput(audioBase64, inputKind);
    this.createResponse();
    return true;
  }

  private commitAudioInput(
    audioBase64: string,
    inputKind: QwenAudioInputKind,
  ) {
    this.pendingInputKinds.push(inputKind);
    this.sendEvent({ type: "input_audio_buffer.clear" });
    this.hasPendingStreamAudio = false;
    this.appendAudio(audioBase64);
    this.sendEvent({ type: "input_audio_buffer.commit" });
  }

  private appendAudio(audioBase64: string) {
    for (
      let offset = 0;
      offset < audioBase64.length;
      offset += QWEN_AUDIO_CHUNK_BASE64_LENGTH
    ) {
      this.sendEvent({
        type: "input_audio_buffer.append",
        audio: audioBase64.slice(
          offset,
          offset + QWEN_AUDIO_CHUNK_BASE64_LENGTH,
        ),
      });
    }
  }

  private queueMusicAudio(audioBase64: string) {
    const byteLength = getBase64ByteLength(audioBase64);
    const maxBytes =
      QWEN_PCM_BYTES_PER_SECOND *
      QWEN_PRECONNECT_MUSIC_BUFFER_SECONDS;
    this.queuedMusicAudio.push(audioBase64);
    this.queuedMusicAudioBytes += byteLength;

    while (
      this.queuedMusicAudioBytes > maxBytes &&
      this.queuedMusicAudio.length > 1
    ) {
      const removed = this.queuedMusicAudio.shift();
      if (removed) {
        this.queuedMusicAudioBytes -= getBase64ByteLength(removed);
      }
    }
  }

  private flushQueuedMusicAudio() {
    if (!this.isReady() || !this.queuedMusicAudio.length) return;

    for (const audioBase64 of this.queuedMusicAudio) {
      this.appendAudio(audioBase64);
    }
    this.pendingMusicAudioBytes += this.queuedMusicAudioBytes;
    this.queuedMusicAudio = [];
    this.queuedMusicAudioBytes = 0;
    this.hasPendingStreamAudio = true;
  }

  private createResponse(responseWithAudio = true) {
    this.responseActive = true;
    this.finalText = "";
    this.sendEvent({
      type: "response.create",
      response: {
        modalities: responseWithAudio
          ? ["text", "audio"]
          : ["text"],
      },
    });
    this.options.onStatusChange?.("streaming");
  }

  private resetPendingAudioInputs() {
    this.pendingInputKinds = [];
    this.inputKindByItemId.clear();
    this.hasPendingStreamAudio = false;
    this.hasPendingVoiceAudio = false;
    this.pendingMusicAudioBytes = 0;
    this.queuedMusicAudio = [];
    this.queuedMusicAudioBytes = 0;
    this.liveVoiceMode = false;
    this.responseActive = false;
  }

  private sendSessionUpdate(
    instructions = DEFAULT_INSTRUCTIONS,
    enableInputTranscription = false,
    turnDetection: null | {
      type: "server_vad";
      threshold: number;
      silence_duration_ms: number;
    } = null,
  ) {
    this.sendEvent({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        voice: "Tina",
        input_audio_format: "pcm",
        output_audio_format: "pcm",
        max_tokens: QWEN_MAX_OUTPUT_TOKENS,
        // 歌曲由 Omni 直接理解，不做文字转写；只有麦克风语音开启
        // ASR，用于在历史区显示用户实际说的话。
        input_audio_transcription: enableInputTranscription
          ? {
              model: "qwen3-asr-flash-realtime",
            }
          : null,
        turn_detection: turnDetection,
        instructions,
      },
    });
  }

  private sendEvent(event: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(event));
  }

  private handleMessage(rawData: unknown) {
    const text =
      typeof rawData === "string" ? rawData : String(rawData);

    let event: unknown = null;

    try {
      event = JSON.parse(text);
    } catch {
      return;
    }

    this.options.onRawEvent?.(event);

    const eventType = getEventType(event);

    if (eventType === "proxy.connected") {
      this.sendSessionUpdate();
      return;
    }

    if (eventType === "proxy.closed") {
      this.isConfigured = false;
      this.resetPendingAudioInputs();
      this.socket = null;
      this.options.onStatusChange?.("closed");
      return;
    }

    if (eventType === "proxy.blocked_audio_event") {
      return;
    }

    if (eventType === "session.created") {
      return;
    }

    if (eventType === "session.updated") {
      this.isConfigured = true;
      this.flushQueuedMusicAudio();
      this.options.onStatusChange?.("configured");
      return;
    }

    if (eventType === "input_audio_buffer.speech_started") {
      this.options.onSpeechStarted?.();
      return;
    }

    if (eventType === "input_audio_buffer.speech_stopped") {
      this.options.onSpeechStopped?.();
      return;
    }

    if (eventType === "input_audio_buffer.committed") {
      const record = getRecord(event);
      const itemId =
        record && typeof record.item_id === "string"
          ? record.item_id
          : "";
      const inputKind =
        this.pendingInputKinds.shift() ??
        (this.liveVoiceMode ? "voice" : null);

      if (itemId && inputKind) {
        this.inputKindByItemId.set(itemId, inputKind);
      }

      return;
    }

    if (
      eventType ===
      "conversation.item.input_audio_transcription.completed"
    ) {
      const record = getRecord(event);
      const itemId =
        record && typeof record.item_id === "string"
          ? record.item_id
          : "";
      const transcript = getDoneText(event).trim();
      const inputKind = itemId
        ? this.inputKindByItemId.get(itemId) ?? null
        : null;
      if (itemId) this.inputKindByItemId.delete(itemId);
      if (transcript) {
        // 输入转写只会在 sendVoiceMessage 中开启；即使上游漏发
        // committed/item_id，也应把结果归到用户语音，而不是让 UI
        // 永久停在“语音消息”。
        this.options.onInputTranscriptDone?.(
          transcript,
          inputKind ?? "voice",
        );
      }
      return;
    }

    if (
      eventType ===
      "conversation.item.input_audio_transcription.failed"
    ) {
      const record = getRecord(event);
      const itemId =
        record && typeof record.item_id === "string"
          ? record.item_id
          : "";
      const inputKind = itemId
        ? this.inputKindByItemId.get(itemId) ?? null
        : null;
      if (itemId) this.inputKindByItemId.delete(itemId);
      this.options.onInputTranscriptFailed?.(
        inputKind ?? "voice",
      );
      return;
    }

    if (eventType === "response.created") {
      this.finalText = "";
      this.options.onAudioStart?.();
      this.options.onStatusChange?.("streaming");
      return;
    }

    if (eventType === "response.text.delta") {
      const delta = getDeltaText(event);
      this.finalText += delta;
      this.options.onTextDelta?.(delta);
      return;
    }

    if (eventType === "response.text.done") {
      const doneText = getDoneText(event) || this.finalText;
      this.options.onTextDone?.(doneText);
      this.finalText = "";
      this.options.onStatusChange?.("configured");
      return;
    }

    if (eventType === "response.audio_transcript.delta") {
      const delta = getDeltaText(event);
      this.finalText += delta;
      this.options.onTextDelta?.(delta);
      return;
    }

    if (eventType === "response.audio_transcript.done") {
      const doneText = getDoneText(event) || this.finalText;
      this.options.onTextDone?.(doneText);
      this.finalText = "";
      this.options.onStatusChange?.("configured");
      return;
    }

    if (eventType === "response.audio.delta") {
      const audioBase64 = getDeltaText(event);
      if (audioBase64) this.options.onAudioDelta?.(audioBase64);
      return;
    }

    if (eventType === "response.audio.done") {
      this.options.onAudioDone?.();
      return;
    }

    if (eventType === "response.done") {
      if (this.finalText.trim()) {
        this.options.onTextDone?.(this.finalText.trim());
      }

      this.finalText = "";
      this.responseActive = false;
      this.options.onResponseDone?.();
      this.options.onStatusChange?.("configured");
      return;
    }

    if (eventType === "error" || eventType === "proxy.error") {
      const message = getErrorMessage(event);
      this.isConfigured = false;
      this.responseActive = false;
      this.options.onStatusChange?.("error");
      this.options.onError?.(message);
    }
  }
}
