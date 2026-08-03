export type QwenRealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "configured"
  | "streaming"
  | "closed"
  | "error";

export type QwenRealtimeClientOptions = {
  url?: string;
  onStatusChange?: (status: QwenRealtimeStatus) => void;
  onTextDelta?: (delta: string) => void;
  onTextDone?: (text: string) => void;
  onAudioStart?: () => void;
  onAudioDelta?: (audioBase64: string) => void;
  onAudioDone?: () => void;
  onInputTranscriptDone?: (text: string) => void;
  onError?: (message: string) => void;
  onRawEvent?: (event: unknown) => void;
};

const LOCAL_PROXY_URL = "ws://localhost:8787/qwen-realtime";

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
  "你是 MusicCompanion，一个正在和用户一起听歌的中文陪伴型音乐伙伴。你不是乐评人，也不是鉴赏课老师，而是坐在旁边一起听歌的朋友。你需要根据用户发来的播放时间、歌曲信息、本地音频特征和最近对话回复。回复要短、松弛、像普通人随口说的话；不要套固定口头禅；不要写成乐评、作文或总结；不要只说变活了、清爽、舒服、有感觉这类空泛评价；要说明具体是哪个声音、哪个位置或哪种变化带来感受；不要复述技术指标；不要编造你实际没有听到的具体乐器或歌词。";

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
      this.options.onStatusChange?.("error");
      this.options.onError?.("Realtime WebSocket 连接错误。");
    });

    socket.addEventListener("close", () => {
      this.isConfigured = false;
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
    this.options.onStatusChange?.("closed");
  }

  public isReady() {
    return (
      this.isConfigured &&
      this.socket !== null &&
      this.socket.readyState === WebSocket.OPEN
    );
  }

  public sendTextMessage(text: string) {
    const cleanText = text.trim();

    if (!cleanText || !this.isReady()) {
      return false;
    }

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

    this.sendEvent({
      type: "response.create",
      response: {
        modalities: ["text"],
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
    if (!audioBase64 || !this.isReady()) return false;

    this.sendSessionUpdate(instructions);
    this.sendEvent({ type: "input_audio_buffer.clear" });
    this.sendEvent({
      type: "input_audio_buffer.append",
      audio: audioBase64,
    });
    this.sendEvent({ type: "input_audio_buffer.commit" });
    this.finalText = "";
    this.sendEvent({
      type: "response.create",
      response: { modalities: ["text", "audio"] },
    });
    this.options.onStatusChange?.("streaming");
    return true;
  }

  private sendSessionUpdate(instructions = DEFAULT_INSTRUCTIONS) {
    this.sendEvent({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        voice: "Tina",
        input_audio_format: "pcm",
        output_audio_format: "pcm",
        input_audio_transcription: {
          model: "qwen3-asr-flash-realtime",
        },
        turn_detection: null,
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
      this.options.onStatusChange?.("configured");
      return;
    }

    if (
      eventType ===
      "conversation.item.input_audio_transcription.completed"
    ) {
      const transcript = getDoneText(event).trim();
      if (transcript) this.options.onInputTranscriptDone?.(transcript);
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
      this.options.onStatusChange?.("configured");
      return;
    }

    if (eventType === "error" || eventType === "proxy.error") {
      const message = getErrorMessage(event);
      this.isConfigured = false;
      this.options.onStatusChange?.("error");
      this.options.onError?.(message);
    }
  }
}
