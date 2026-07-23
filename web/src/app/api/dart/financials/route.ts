import { fetchFinancialStatements } from "@/lib/dart";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const corpCode = searchParams.get("corp_code");
  const bsnsYear = searchParams.get("bsns_year");
  const reprtCode = searchParams.get("reprt_code") ?? "11011";
  const fsDiv = (searchParams.get("fs_div") ?? "OFS") as "OFS" | "CFS";

  if (!corpCode || !bsnsYear) {
    return Response.json(
      { error: "corp_code와 bsns_year는 필수입니다." },
      { status: 400 }
    );
  }

  try {
    const financials = await fetchFinancialStatements(
      corpCode,
      bsnsYear,
      reprtCode,
      fsDiv
    );
    return Response.json({ financials });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
