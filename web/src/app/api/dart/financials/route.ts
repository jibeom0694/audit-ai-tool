import { DartNoDataError, fetchFinancialStatements } from "@/lib/dart";

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
    // 데이터 없음은 서버 고장이 아니므로 500과 구분한다. 화면은 code를 보고
    // 감사보고서 원문·엑셀·AI 인식 경로를 안내한다.
    if (error instanceof DartNoDataError) {
      return Response.json(
        { error: error.message, code: "DART_NO_DATA" },
        { status: 404 }
      );
    }
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
