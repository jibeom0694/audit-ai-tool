import { fetchRecentDisclosures } from "@/lib/dart";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const corpCode = searchParams.get("corp_code");

  if (!corpCode) {
    return Response.json({ error: "corp_code는 필수입니다." }, { status: 400 });
  }

  try {
    const disclosures = await fetchRecentDisclosures(corpCode, 10);
    return Response.json({ disclosures });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
