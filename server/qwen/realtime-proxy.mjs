import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const QWEN_REALTIME_MODEL =
  process.env.QWEN_REALTIME_MODEL || "qwen3.5-omni-flash-realtime";
const PORT = Number(process.env.QWEN_REALTIME_PROXY_PORT || 8787);
const PATHNAME = "/qwen-realtime";
const qwenRealtimeUrl = new URL(
  process.env.QWEN_REALTIME_UPSTREAM_URL ||
    "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
);

qwenRealtimeUrl.searchParams.set("model", QWEN_REALTIME_MODEL);

const QWEN_REALTIME_URL = qwenRealtimeUrl.toString();

if (!DASHSCOPE_API_KEY) {
  console.error("[Proxy] 缺少 DASHSCOPE_API_KEY。请检查 .env.local。");
  process.exit(1);
}

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        ok: true,
        model: QWEN_REALTIME_MODEL,
      }),
    );
    return;
  }

  response.writeHead(404, {
    "content-type": "text/plain; charset=utf-8",
  });
  response.end("Not found");
});

const wss = new WebSocketServer({
  server,
  path: PATHNAME,
});

function safeSend(socket, data) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(data);
}

wss.on("connection", (browserSocket) => {
  console.log("[Proxy] 浏览器已连接。");

  let qwenSocket = null;
  let qwenSessionCreated = false;
  let browserClosed = false;

  qwenSocket = new WebSocket(QWEN_REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
    },
  });

  console.log(`[Proxy] 正在连接千问 Realtime：${QWEN_REALTIME_URL}`);

  qwenSocket.on("open", () => {
    console.log("[Proxy] 千问 Realtime WebSocket 已打开，等待 session.created。");
  });

  qwenSocket.on("message", (data) => {
    const text = data.toString();

    let event = null;

    try {
      event = JSON.parse(text);
    } catch {
      safeSend(browserSocket, text);
      return;
    }

    if (event.type === "session.created") {
      qwenSessionCreated = true;

      safeSend(browserSocket, text);
      safeSend(
        browserSocket,
        JSON.stringify({
          type: "proxy.connected",
        }),
      );

      console.log("[Qwen -> Browser] session.created");
      return;
    }

    if (event.type === "response.done" && event.response?.usage) {
      console.log(
        `[Qwen Token Usage] ${JSON.stringify(event.response.usage)}`,
      );
    }

    safeSend(browserSocket, text);
  });

  qwenSocket.on("error", (error) => {
    console.error("[Proxy] 千问连接错误：", error);

    safeSend(
      browserSocket,
      JSON.stringify({
        type: "proxy.error",
        error:
          error instanceof Error
            ? error.message
            : "千问 Realtime 连接错误。",
      }),
    );
  });

  qwenSocket.on("close", (code, reasonBuffer) => {
    const reason = reasonBuffer.toString();

    console.log("[Proxy] 千问连接关闭详情：", {
      code,
      reason,
      qwenReadyState: qwenSocket?.readyState,
      browserReadyState: browserSocket.readyState,
      qwenSessionCreated,
    });

    if (!browserClosed) {
      safeSend(
        browserSocket,
        JSON.stringify({
          type: "proxy.closed",
          code,
          reason,
        }),
      );
    }
  });

  browserSocket.on("message", (data) => {
    const text = data.toString();

    try {
      JSON.parse(text);
    } catch {
      return;
    }

    if (!qwenSocket || qwenSocket.readyState !== WebSocket.OPEN) {
      safeSend(
        browserSocket,
        JSON.stringify({
          type: "proxy.error",
          error: "千问 Realtime 还没有连接成功。",
        }),
      );
      return;
    }

    qwenSocket.send(text);
  });

  browserSocket.on("close", () => {
    browserClosed = true;
    console.log("[Proxy] 浏览器连接关闭。");

    if (qwenSocket && qwenSocket.readyState === WebSocket.OPEN) {
      qwenSocket.close(1000, "Browser closed");
    }
  });
});

server.listen(PORT, () => {
  console.log(
    `[Proxy] Qwen Realtime Proxy 已启动：ws://localhost:${PORT}${PATHNAME}`,
  );
  console.log(`[Proxy] Health Check：http://localhost:${PORT}/health`);
  console.log(`[Proxy] 模型：${QWEN_REALTIME_MODEL}`);
});
