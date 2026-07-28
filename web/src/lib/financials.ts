export type StatementRow = {
  account: string;
  prior: number;
  current: number;
  /** 실제 재무제표에 표기된 순서(있으면). 재무상태표를 "양식대로" 보여줄 때 씀. */
  ord?: number;
};

/**
 * 세 입력 경로(DART/엑셀 템플릿/Upstage 인식)가 공통으로 맞춰야 하는 표준 구조.
 * 현금흐름표(cf)는 선택 항목 — Beneish M-Score의 TATA(총발생액지수) 계산에만
 * 쓰이며, DART·엑셀은 제공되지만 Upstage 인식 경로는 현금흐름표를 추출하지
 * 않아 없을 수 있다.
 */
export type NormalizedFinancials = {
  bs: StatementRow[];
  is: StatementRow[];
  cf?: StatementRow[];
};

/**
 * 계정과목명은 출처마다 표기가 다르다(DART 원문 계정명 vs 표준 템플릿 vs Upstage
 * 추출 필드명). 개념별로 후보 이름을 여러 개 등록해두고, 공백을 무시한 부분일치로
 * 찾는다.
 */
export const ACCOUNT_ALIASES = {
  // "유동자산" 단독으로 찾으면 표준 템플릿의 "기타유동자산" 행이 부분일치로
  // 먼저 걸려 "유동자산합계"(진짜 유동성 비율 분모)보다 앞서 매칭돼버린다.
  // 합계 행을 먼저 찾도록 후보를 앞에 둔다.
  유동자산: ["유동자산합계", "유동자산"],
  유동부채: ["유동부채합계", "유동부채"],
  재고자산: ["재고자산"],
  매출채권: ["매출채권", "매출채권및기타채권", "매출채권및기타유동채권"],
  자산총계: ["자산총계"],
  부채총계: ["부채총계"],
  자본총계: ["자본총계"],
  매출액: ["매출액", "수익(매출액)", "영업수익", "매출"],
  매출원가: ["매출원가"],
  매출총이익: ["매출총이익"],
  판매비와관리비: ["판매비와관리비", "판매비와 관리비"],
  영업이익: ["영업이익", "영업이익(손실)"],
  영업외수익: ["영업외수익", "기타수익", "금융수익"],
  영업외비용: ["영업외비용", "기타비용", "금융비용"],
  이자비용: ["이자비용"],
  법인세비용: ["법인세비용", "법인세비용(수익)"],
  당기순이익: [
    "당기순이익",
    "당기순이익(손실)",
    "반기순이익",
    "분기순이익",
    "연결당기순이익",
  ],
  기본주당이익: ["기본주당이익", "기본주당순이익", "주당순이익", "주당이익"],
  유형자산: ["유형자산"],
  감가상각비: ["감가상각비"],
  영업활동현금흐름: ["영업활동현금흐름", "영업활동으로인한현금흐름"],
  이익잉여금: ["이익잉여금", "미처분이익잉여금"],
} as const;

export type AccountKey = keyof typeof ACCOUNT_ALIASES;

function normalize(text: string): string {
  return text.replace(/\s/g, "");
}

export function findAccountRow(
  rows: StatementRow[],
  key: AccountKey
): StatementRow | null {
  const candidates = ACCOUNT_ALIASES[key];
  for (const candidate of candidates) {
    const target = normalize(candidate);
    const row = rows.find((r) => normalize(r.account).includes(target));
    if (row) return row;
  }
  return null;
}

export function findAccountValue(
  rows: StatementRow[],
  key: AccountKey,
  period: "current" | "prior"
): number | null {
  const row = findAccountRow(rows, key);
  if (!row) return null;
  const value = row[period];
  return Number.isFinite(value) ? value : null;
}
