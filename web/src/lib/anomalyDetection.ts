import type { JournalRow } from "./excelParse";
import { findAccountValue, type NormalizedFinancials } from "./financials";

/* ────────────────────────────────────────────────────────────────
 * 1. Benford's Law (벤포드 법칙)
 * ──────────────────────────────────────────────────────────────── */

export type BenfordDigitRow = {
  digit: number;
  actualPercent: number;
  expectedPercent: number;
  deviation: number;
};

export type BenfordResult = {
  sampleSize: number;
  digits: BenfordDigitRow[];
  chiSquare: number;
  isSuspicious: boolean;
};

const BENFORD_MIN_SAMPLE_SIZE = 30;
// 자유도 8, 유의수준 5%의 카이제곱 임계값. 이보다 크면 벤포드 분포에서
// 유의미하게 벗어난 것으로 본다.
const BENFORD_CHI_SQUARE_CRITICAL = 15.51;

/** 거래금액 목록(0보다 큰 값)의 맨 앞자리 숫자 분포를 벤포드 법칙의 이론
 * 분포와 비교한다. 표본이 30건 미만이면 통계적으로 의미가 없어 null을
 * 반환한다. */
export function runBenfordTest(amounts: number[]): BenfordResult | null {
  const values = amounts.map((v) => Math.trunc(Math.abs(v))).filter((v) => v >= 1);
  if (values.length < BENFORD_MIN_SAMPLE_SIZE) return null;

  const counts = new Array(10).fill(0);
  for (const v of values) {
    const firstDigit = Number(String(v)[0]);
    if (firstDigit >= 1 && firstDigit <= 9) counts[firstDigit]++;
  }

  const n = values.length;
  let chiSquare = 0;
  const digits: BenfordDigitRow[] = [];
  for (let d = 1; d <= 9; d++) {
    const expectedPercent = Math.log10(1 + 1 / d) * 100;
    const expectedCount = (expectedPercent / 100) * n;
    const actualPercent = (counts[d] / n) * 100;
    chiSquare += (counts[d] - expectedCount) ** 2 / expectedCount;
    digits.push({
      digit: d,
      actualPercent,
      expectedPercent,
      deviation: actualPercent - expectedPercent,
    });
  }

  return {
    sampleSize: n,
    digits,
    chiSquare,
    isSuspicious: chiSquare > BENFORD_CHI_SQUARE_CRITICAL,
  };
}

/* ────────────────────────────────────────────────────────────────
 * 2. Beneish M-Score (베니시 M-스코어)
 * ──────────────────────────────────────────────────────────────── */

export type BeneishComponent = {
  key: string;
  label: string;
  value: number | null;
};

export type BeneishResult = {
  score: number;
  isSuspicious: boolean;
  components: BeneishComponent[];
};

/** 8개 지수를 계산해 이익조작 가능성 점수(M-Score)를 산출한다. 필요한
 * 계정(당기·전기 모두) 중 하나라도 없으면 null(데이터 부족)을 반환한다.
 * TATA(총발생액지수) 계산에는 영업활동현금흐름이 필요해 현금흐름표가 없는
 * Upstage 인식 경로에서는 계산되지 않는다. */
export function calculateBeneishMScore(
  financials: NormalizedFinancials
): BeneishResult | null {
  const { bs, is, cf } = financials;
  const cfAndIs = [...is, ...(cf ?? [])];

  const 매출채권_전기 = findAccountValue(bs, "매출채권", "prior");
  const 매출채권_당기 = findAccountValue(bs, "매출채권", "current");
  const 매출액_전기 = findAccountValue(is, "매출액", "prior");
  const 매출액_당기 = findAccountValue(is, "매출액", "current");
  const 매출원가_전기 = findAccountValue(is, "매출원가", "prior");
  const 매출원가_당기 = findAccountValue(is, "매출원가", "current");
  const 유동자산_전기 = findAccountValue(bs, "유동자산", "prior");
  const 유동자산_당기 = findAccountValue(bs, "유동자산", "current");
  const 유형자산_전기 = findAccountValue(bs, "유형자산", "prior");
  const 유형자산_당기 = findAccountValue(bs, "유형자산", "current");
  const 자산총계_전기 = findAccountValue(bs, "자산총계", "prior");
  const 자산총계_당기 = findAccountValue(bs, "자산총계", "current");
  const 감가상각비_전기 = findAccountValue(cfAndIs, "감가상각비", "prior");
  const 감가상각비_당기 = findAccountValue(cfAndIs, "감가상각비", "current");
  const 판관비_전기 = findAccountValue(is, "판매비와관리비", "prior");
  const 판관비_당기 = findAccountValue(is, "판매비와관리비", "current");
  const 부채총계_전기 = findAccountValue(bs, "부채총계", "prior");
  const 부채총계_당기 = findAccountValue(bs, "부채총계", "current");
  const 당기순이익_당기 = findAccountValue(is, "당기순이익", "current");
  const 영업활동현금흐름_당기 = findAccountValue(
    cf ?? [],
    "영업활동현금흐름",
    "current"
  );

  const required = [
    매출채권_전기,
    매출채권_당기,
    매출액_전기,
    매출액_당기,
    매출원가_전기,
    매출원가_당기,
    유동자산_전기,
    유동자산_당기,
    유형자산_전기,
    유형자산_당기,
    자산총계_전기,
    자산총계_당기,
    감가상각비_전기,
    감가상각비_당기,
    판관비_전기,
    판관비_당기,
    부채총계_전기,
    부채총계_당기,
    당기순이익_당기,
    영업활동현금흐름_당기,
  ];
  if (required.some((v) => v == null)) return null;
  if (
    매출액_전기 === 0 ||
    매출채권_전기 === 0 ||
    자산총계_전기 === 0 ||
    자산총계_당기 === 0 ||
    부채총계_전기 === 0
  ) {
    return null;
  }

  const 매출총이익_전기 = 매출액_전기! - 매출원가_전기!;
  const 매출총이익_당기 = 매출액_당기! - 매출원가_당기!;
  if (매출총이익_전기 === 0 || 매출총이익_당기 === 0) return null;

  const DSRI =
    (매출채권_당기! / 매출액_당기!) / (매출채권_전기! / 매출액_전기!);
  const GMI =
    (매출총이익_전기 / 매출액_전기!) / (매출총이익_당기 / 매출액_당기!);
  const AQI =
    (1 - (유동자산_당기! + 유형자산_당기!) / 자산총계_당기!) /
    (1 - (유동자산_전기! + 유형자산_전기!) / 자산총계_전기!);
  const SGI = 매출액_당기! / 매출액_전기!;
  const depiDenom =
    감가상각비_당기! / (감가상각비_당기! + 유형자산_당기!);
  const DEPI =
    depiDenom === 0
      ? NaN
      : (감가상각비_전기! / (감가상각비_전기! + 유형자산_전기!)) / depiDenom;
  const SGAI =
    (판관비_당기! / 매출액_당기!) / (판관비_전기! / 매출액_전기!);
  const LVGI =
    (부채총계_당기! / 자산총계_당기!) / (부채총계_전기! / 자산총계_전기!);
  const TATA = (당기순이익_당기! - 영업활동현금흐름_당기!) / 자산총계_당기!;

  const values = [DSRI, GMI, AQI, SGI, DEPI, SGAI, LVGI, TATA];
  if (values.some((v) => !Number.isFinite(v))) return null;

  const score =
    -4.84 +
    0.92 * DSRI +
    0.528 * GMI +
    0.404 * AQI +
    0.892 * SGI +
    0.115 * DEPI -
    0.172 * SGAI +
    4.679 * TATA -
    0.327 * LVGI;

  return {
    score,
    isSuspicious: score > -1.78,
    components: [
      { key: "DSRI", label: "매출채권지수", value: DSRI },
      { key: "GMI", label: "매출총이익률지수", value: GMI },
      { key: "AQI", label: "자산품질지수", value: AQI },
      { key: "SGI", label: "매출성장지수", value: SGI },
      { key: "DEPI", label: "감가상각지수", value: DEPI },
      { key: "SGAI", label: "판관비지수", value: SGAI },
      { key: "LVGI", label: "레버리지지수", value: LVGI },
      { key: "TATA", label: "총발생액지수", value: TATA },
    ],
  };
}

/* ────────────────────────────────────────────────────────────────
 * 3. Altman Z'-Score (알트만 Z'-스코어, 비상장기업용 — 자기자본 장부가액 기준)
 * ──────────────────────────────────────────────────────────────── */

export type AltmanZone = "safe" | "grey" | "distress";

export type AltmanResult = {
  score: number;
  zone: AltmanZone;
  components: { key: string; label: string; value: number }[];
};

/** 5개 재무비율을 가중합산해 부도(파산) 가능성을 추정한다. 시가총액이 필요한
 * 원래 Z-Score 대신, 비상장기업에도 쓸 수 있도록 자기자본을 장부가액(자본
 * 총계)으로 대체한 Z'-Score 계수를 사용한다. */
export function calculateAltmanZScore(
  financials: NormalizedFinancials
): AltmanResult | null {
  const { bs, is } = financials;

  const 유동자산 = findAccountValue(bs, "유동자산", "current");
  const 유동부채 = findAccountValue(bs, "유동부채", "current");
  const 자산총계 = findAccountValue(bs, "자산총계", "current");
  const 이익잉여금 = findAccountValue(bs, "이익잉여금", "current");
  const 영업이익 = findAccountValue(is, "영업이익", "current");
  const 자본총계 = findAccountValue(bs, "자본총계", "current");
  const 부채총계 = findAccountValue(bs, "부채총계", "current");
  const 매출액 = findAccountValue(is, "매출액", "current");

  const required = [
    유동자산,
    유동부채,
    자산총계,
    이익잉여금,
    영업이익,
    자본총계,
    부채총계,
    매출액,
  ];
  if (required.some((v) => v == null) || 자산총계 === 0 || 부채총계 === 0) {
    return null;
  }

  const X1 = (유동자산! - 유동부채!) / 자산총계!;
  const X2 = 이익잉여금! / 자산총계!;
  const X3 = 영업이익! / 자산총계!;
  const X4 = 자본총계! / 부채총계!;
  const X5 = 매출액! / 자산총계!;

  const score = 0.717 * X1 + 0.847 * X2 + 3.107 * X3 + 0.42 * X4 + 0.998 * X5;
  const zone: AltmanZone =
    score > 2.9 ? "safe" : score >= 1.23 ? "grey" : "distress";

  return {
    score,
    zone,
    components: [
      { key: "X1", label: "순운전자본/총자산", value: X1 },
      { key: "X2", label: "이익잉여금/총자산", value: X2 },
      { key: "X3", label: "영업이익/총자산", value: X3 },
      { key: "X4", label: "자기자본(장부가)/부채총계", value: X4 },
      { key: "X5", label: "매출액/총자산", value: X5 },
    ],
  };
}

/* ────────────────────────────────────────────────────────────────
 * 4. RSF 테스트 (Relative Size Factor Test, 상대크기요인 테스트)
 * ──────────────────────────────────────────────────────────────── */

export type RsfFlag = {
  account: string;
  largest: number;
  secondLargest: number;
  rsf: number;
};

// 최댓값이 2번째로 큰 값의 몇 배 이상이면 이상치로 볼지의 임계치.
const RSF_THRESHOLD = 3;

/** 전표데이터를 계정과목별로 묶어, 같은 계정 안에서 가장 큰 금액이 두
 * 번째로 큰 금액에 비해 비정상적으로 크지 않은지 검사한다. 전표데이터가
 * 있는 엑셀 업로드 경로에서만 계산할 수 있다. */
export function runRsfTest(journalRows: JournalRow[]): RsfFlag[] {
  const byAccount = new Map<string, number[]>();
  for (const row of journalRows) {
    const amount = Math.max(row.debit, row.credit);
    if (amount <= 0) continue;
    const key = row.account || "(계정 미기재)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(amount);
  }

  const flags: RsfFlag[] = [];
  for (const [account, amounts] of byAccount) {
    if (amounts.length < 2) continue;
    const sorted = [...amounts].sort((a, b) => b - a);
    const [largest, secondLargest] = sorted;
    if (secondLargest <= 0) continue;
    const rsf = largest / secondLargest;
    if (rsf >= RSF_THRESHOLD) {
      flags.push({ account, largest, secondLargest, rsf });
    }
  }

  return flags.sort((a, b) => b.rsf - a.rsf);
}

/* ────────────────────────────────────────────────────────────────
 * 5. 순환거래(라운드트립) 탐지
 * ──────────────────────────────────────────────────────────────── */

export type RoundTripFlag = {
  counterparty: string;
  date1: string;
  amount1: number;
  date2: string;
  amount2: number;
  daysApart: number;
};

const ROUND_TRIP_WINDOW_DAYS = 30;
const ROUND_TRIP_AMOUNT_TOLERANCE = 0.05; // 금액 차이 5% 이내면 "비슷한 금액"으로 본다

function parseJournalDate(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length !== 8) return null;
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 같은 거래처와 짧은 기간 안에, 방향이 반대(한쪽은 차변 위주 매입/지출성,
 * 다른 쪽은 대변 위주 매출/수입성)이면서 금액이 비슷한 거래 쌍을 찾는다.
 * 실질적인 경제적 효과 없이 자금·상품이 같은 거래처로 되돌아오는 "2자간
 * 라운드트립" 패턴을 잡아내기 위한 것으로, 여러 회사에 걸친 다자간 순환
 * 거래 그래프(A→B→C→A)까지는 한 회사의 전표만으로는 확인할 수 없어 이
 * 범위로 한정했다. */
export function detectRoundTripTransactions(
  journalRows: JournalRow[]
): RoundTripFlag[] {
  const byCounterparty = new Map<string, JournalRow[]>();
  for (const row of journalRows) {
    if (!row.counterparty) continue;
    if (!byCounterparty.has(row.counterparty)) {
      byCounterparty.set(row.counterparty, []);
    }
    byCounterparty.get(row.counterparty)!.push(row);
  }

  const flags: RoundTripFlag[] = [];
  for (const [counterparty, rows] of byCounterparty) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        const aIsDebit = a.debit > a.credit;
        const bIsDebit = b.debit > b.credit;
        if (aIsDebit === bIsDebit) continue;

        const amountA = Math.max(a.debit, a.credit);
        const amountB = Math.max(b.debit, b.credit);
        if (amountA <= 0 || amountB <= 0) continue;
        const diffRatio =
          Math.abs(amountA - amountB) / Math.max(amountA, amountB);
        if (diffRatio > ROUND_TRIP_AMOUNT_TOLERANCE) continue;

        const t1 = parseJournalDate(a.date);
        const t2 = parseJournalDate(b.date);
        if (t1 == null || t2 == null) continue;
        const daysApart = Math.abs(t1 - t2) / (1000 * 60 * 60 * 24);
        if (daysApart > ROUND_TRIP_WINDOW_DAYS) continue;

        flags.push({
          counterparty,
          date1: a.date,
          amount1: amountA,
          date2: b.date,
          amount2: amountB,
          daysApart: Math.round(daysApart),
        });
      }
    }
  }

  return flags.sort((a, b) => a.daysApart - b.daysApart);
}
