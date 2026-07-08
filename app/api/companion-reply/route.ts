export const runtime = "nodejs";

export async function POST() {
  return new Response("普通回复已关闭。", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
