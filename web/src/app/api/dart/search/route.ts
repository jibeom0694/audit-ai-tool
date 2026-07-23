import { loadCorpCodes, searchCorpCodes } from "@/lib/dart";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  if (!q.trim()) {
    return Response.json({ results: [] });
  }

  try {
    const corpCodes = await loadCorpCodes();
    const results = searchCorpCodes(corpCodes, q);
    return Response.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
