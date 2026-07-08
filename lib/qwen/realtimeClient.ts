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
  onError?: (message: string) => void;
  onRawEvent?: (event: unknown) => void;
};

const DEFAULT_PROXY_URL = "ws://localhost:8787/qwen-realtime";
const DEFAULT_INSTRUCTIONS =
  "你是 MusicCompanion，一个正在和用户一起听歌的中文陪伴型音乐伙伴。你需要根据用户发来的播放时间、歌曲信息和最近对话回复。回复要自然、短、像正在一起听歌的人，不要编造你实际没有听到的音频细节。";

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

    const socket = new WebSocket(this.options.url || DEFAULT_PROXY_URL);
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

  private sendSessionUpdate() {
    this.sendEvent({
      type: "session.update",
      session: {
        modalities: ["text"],
        instructions: DEFAULT_INSTRUCTIONS,
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

    if (eventType === "response.created") {
      this.finalText = "";
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
