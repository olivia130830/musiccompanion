export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    {
      error:
        "当前版本已关闭歌名识别接口。MusicCompanion 现在专注于本地听感分析和AI陪听回复。",
    },
    {
      status: 410,
    },
  );
}