import {
  experimental_upgradeWebSocket,
  type WebSocket,
  type WebSocketData,
} from "@vercel/functions";
import { WebSocket as QwenWebSocket } from "ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeSend(socket: WebSocket, data: string) {
  if (socket.readyState === socket.OPEN) {
    socket.send(data);
  }
}

function sendProxyEvent(
  socket: WebSocket,
  event: Record<string, unknown>,
) {
  safeSend(socket, JSON.stringify(event));
}

function createQwenRealtimeUrl() {
  const model =
    process.env.QWEN_REALTIME_MODEL ||
    "qwen3.5-omni-flash-realtime";
  const url = new URL(
    process.env.QWEN_REALTIME_UPSTREAM_URL ||
      "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
  );

  url.searchParams.set("model", model);
  return url.toString();
}

function handleConnection(browserSocket: WebSocket) {
  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (!apiKey) {
    sendProxyEvent(browserSocket, {
      type: "proxy.error",
      error: "Vercel 缺少 DASHSCOPE_API_KEY。",
    });
    browserSocket.close(1011, "Missing DASHSCOPE_API_KEY");
    return;
  }

  const qwenSocket = new QwenWebSocket(createQwenRealtimeUrl(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  let qwenSessionCreated = false;
  const pendingBrowserMessages: string[] = [];

  const flushPendingBrowserMessages = () => {
    if (
      !qwenSessionCreated ||
      qwenSocket.readyState !== QwenWebSocket.OPEN
    ) {
      return;
    }

    for (const message of pendingBrowserMessages.splice(0)) {
      qwenSocket.send(message);
    }
  };

  qwenSocket.on("message", (data) => {
    const text = data.toString();

    safeSend(browserSocket, text);

    try {
      const event = JSON.parse(text) as {
        type?: string;
        response?: { usage?: unknown };
      };

      if (event.type === "session.created") {
        qwenSessionCreated = true;
        sendProxyEvent(browserSocket, {
          type: "proxy.connected",
        });
        flushPendingBrowserMessages();
      }

      if (event.type === "response.done" && event.response?.usage) {
        console.log(
          `[Qwen Token Usage] ${JSON.stringify(event.response.usage)}`,
        );
      }
    } catch {}
  });

  qwenSocket.on("error", (error) => {
    sendProxyEvent(browserSocket, {
      type: "proxy.error",
      error: error.message || "千问 Realtime 连接错误。",
    });
  });

  qwenSocket.on("close", (code, reasonBuffer) => {
    sendProxyEvent(browserSocket, {
      type: "proxy.closed",
      code,
      reason: reasonBuffer.toString(),
    });
  });

  browserSocket.on("message", (data: WebSocketData) => {
    const text = data.toString();
    let event: { type?: string };

    try {
      event = JSON.parse(text) as { type?: string };
    } catch {
      return;
    }

    if (event.type === "proxy.ping") {
      sendProxyEvent(browserSocket, { type: "proxy.pong" });
      return;
    }

    if (
      !qwenSessionCreated ||
      qwenSocket.readyState !== QwenWebSocket.OPEN
    ) {
      // The browser socket normally opens before DashScope has created its
      // Realtime session. Buffer this short startup race instead of exposing
      // a false connection error to the user.
      if (pendingBrowserMessages.length >= 64) {
        pendingBrowserMessages.shift();
      }
      pendingBrowserMessages.push(text);
      return;
    }

    qwenSocket.send(text);
  });

  browserSocket.on("close", () => {
    if (
      qwenSocket.readyState === QwenWebSocket.OPEN ||
      qwenSocket.readyState === QwenWebSocket.CONNECTING
    ) {
      qwenSocket.close(1000, "Browser closed");
    }
  });
}

export function GET() {
  return experimental_upgradeWebSocket(handleConnection);
}
