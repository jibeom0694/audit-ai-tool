import { fetchRecentDisclosures } from "@/lib/dart";
import { disclosureWindowForFiscalYear } from "@/lib/disclosureRisk";

// 감사 화면은 사업연도(fiscal_year)를 함께 보낸다. 그러면 조회 창이 "오늘 기준
// 1년"이 아니라 "그 사업연도 + 후속사건 기간"으로 잡혀, 오래된 연도를 조회해도
// 감사 대상 기간의 공시가 빠지지 않는다. 사업연도가 없으면 종전대로 최근 1년.
const MAX_COUNT = 100;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const corpCode = searchParams.get("corp_code");
  const fiscalYearEnd = searchParams.get("fiscal_year_end");

  if (!corpCode) {
    return Response.json({ error: "corp_code는 필수입니다." }, { status: 400 });
  }

  try {
    const range = fiscalYearEnd
      ? (disclosureWindowForFiscalYear(fiscalYearEnd) ?? undefined)
      : undefined;
    const disclosures = await fetchRecentDisclosures(
      corpCode,
      MAX_COUNT,
      range
    );
    return Response.json({ disclosures, range: range ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
