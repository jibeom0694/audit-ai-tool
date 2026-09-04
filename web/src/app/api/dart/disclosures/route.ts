import { fetchRecentDisclosures, type Disclosure } from "@/lib/dart";
import {
  disclosureWindowForFiscalYear,
  fiscalYearEndCompact,
} from "@/lib/disclosureRisk";

/**
 * 감사 화면은 사업연도(fiscal_year_end)를 함께 보낸다. 그러면 조회 창이 "오늘
 * 기준 1년"이 아니라 그 사업연도에 맞춰 잡힌다.
 *
 * 두 기간을 따로 조회해 합친다. DART는 최신순 한 페이지만 주므로 한 번에
 * 불러오면 공시가 잦은 회사에서는 결산 직후 몇 달치가 한도를 다 먹고 사업연도
 * 중 공시가 통째로 잘려나간다(삼성전자 FY2025에서 100건 전부가 결산 후 90일
 * 안이었다). 감사인은 "기중에 무슨 일이 있었나"와 "결산 후에 무슨 일이
 * 있었나"를 둘 다 봐야 하므로, 각 기간에 자리를 따로 준다.
 */
const PER_PERIOD = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const corpCode = searchParams.get("corp_code");
  const fiscalYearEnd = searchParams.get("fiscal_year_end");

  if (!corpCode) {
    return Response.json({ error: "corp_code는 필수입니다." }, { status: 400 });
  }

  try {
    const window = fiscalYearEnd
      ? disclosureWindowForFiscalYear(fiscalYearEnd)
      : null;
    const yearEnd = fiscalYearEnd ? fiscalYearEndCompact(fiscalYearEnd) : null;

    if (!window || !yearEnd) {
      // 사업연도를 모르면 종전대로 최근 1년.
      const disclosures = await fetchRecentDisclosures(corpCode, PER_PERIOD);
      return Response.json({ disclosures, truncated: false });
    }

    const [inYear, subsequent] = await Promise.all([
      fetchRecentDisclosures(corpCode, PER_PERIOD, {
        bgnDe: window.bgnDe,
        endDe: yearEnd,
      }),
      fetchRecentDisclosures(corpCode, PER_PERIOD, {
        bgnDe: yearEnd,
        endDe: window.endDe,
      }),
    ]);

    // 결산일 당일 공시는 두 창에 모두 걸리므로 접수번호로 중복을 제거한다.
    const seen = new Set<string>();
    const disclosures: Disclosure[] = [...subsequent, ...inYear]
      .filter((d) => (seen.has(d.receiptNo) ? false : seen.add(d.receiptNo)))
      .sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));

    return Response.json({
      disclosures,
      // 어느 한쪽이 한도를 채웠다면 그 기간에 더 있는데 못 보여준 것이다.
      truncated: inYear.length >= PER_PERIOD || subsequent.length >= PER_PERIOD,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
