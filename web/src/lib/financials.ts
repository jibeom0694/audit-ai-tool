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

/**
 * 일부 개념은 재무제표에 "합계 한 줄"로 나오기도 하고, 여러 구성계정으로 쪼개져
 * 나오기도 한다. 대표적으로 DART 손익계산서는 영업외수익을 한 줄로 주지 않고
 * **기타수익과 금융수익으로 나눠서** 준다(비용도 마찬가지).
 *
 * 이때 별칭 목록에서 첫 매칭 한 줄만 집으면 나머지 구성계정이 통째로 누락된다
 * (예: 기타수익만 잡히고 금융수익은 사라져 영업외수익이 과소계상된다). 그래서
 * 이런 개념은 "합계행이 있으면 그 행, 없으면 구성계정을 모두 합산"으로 읽는다.
 *
 * 구성계정만 있는 경우 합산하므로, 합계행 하나만 있는 엑셀 템플릿 경로에서는
 * 기존과 동일하게 동작한다.
 */
const ADDITIVE_ACCOUNTS: Partial<
  Record<AccountKey, { total: string[]; parts: string[] }>
> = {
  영업외수익: { total: ["영업외수익"], parts: ["기타수익", "금융수익"] },
  영업외비용: { total: ["영업외비용"], parts: ["기타비용", "금융비용"] },
};

function normalize(text: string): string {
  return text.replace(/\s/g, "");
}

function findFirstMatch(
  rows: StatementRow[],
  candidates: readonly string[]
): StatementRow | null {
  for (const candidate of candidates) {
    const target = normalize(candidate);
    const row = rows.find((r) => normalize(r.account).includes(target));
    if (row) return row;
  }
  return null;
}

/**
 * 주어진 패턴들에 걸리는 행을 모두 합산한다. 한 행이 여러 패턴에 동시에 걸려도
 * (예: "기타비용(금융비용)") 한 번만 더하도록 이미 쓴 행을 기록해 중복합산을 막는다.
 * 걸리는 행이 하나도 없으면 null(데이터 없음) — 0원과 구분해야 한다.
 */
function sumMatchingRows(
  rows: StatementRow[],
  patterns: readonly string[],
  period: "current" | "prior"
): number | null {
  const used = new Set<StatementRow>();
  let sum = 0;
  let matched = false;

  for (const pattern of patterns) {
    const target = normalize(pattern);
    for (const row of rows) {
      if (used.has(row)) continue;
      if (!normalize(row.account).includes(target)) continue;
      const value = row[period];
      if (!Number.isFinite(value)) continue;
      used.add(row);
      sum += value;
      matched = true;
    }
  }

  return matched ? sum : null;
}

export function findAccountRow(
  rows: StatementRow[],
  key: AccountKey
): StatementRow | null {
  return findFirstMatch(rows, ACCOUNT_ALIASES[key]);
}

export function findAccountValue(
  rows: StatementRow[],
  key: AccountKey,
  period: "current" | "prior"
): number | null {
  const additive = ADDITIVE_ACCOUNTS[key];
  if (additive) {
    // 합계행이 있으면 그것이 곧 정답이다(구성계정까지 더하면 이중계상된다).
    const totalRow = findFirstMatch(rows, additive.total);
    if (totalRow) {
      const value = totalRow[period];
      return Number.isFinite(value) ? value : null;
    }
    return sumMatchingRows(rows, additive.parts, period);
  }

  const row = findAccountRow(rows, key);
  if (!row) return null;
  const value = row[period];
  return Number.isFinite(value) ? value : null;
}
