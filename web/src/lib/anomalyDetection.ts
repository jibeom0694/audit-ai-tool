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

// Nigrini의 MAD(평균절대편차) 적합도 등급. 카이제곱과 달리 표본크기에 좌우되지
// 않아, 큰 원장에서도 사소한 편차를 "이상"으로 과탐하지 않는다.
export type BenfordConformity =
  | "close" // 근접 적합
  | "acceptable" // 허용 가능
  | "marginal" // 경계
  | "nonconform"; // 부적합(이상)

export type BenfordResult = {
  sampleSize: number;
  digits: BenfordDigitRow[]; // 첫자리 1~9
  chiSquare: number; // 참고용(표본 크면 과탐 경향)
  mad: number; // 첫자리 MAD
  conformity: BenfordConformity; // MAD 기반 1차 판정(표본크기 무관)
  isSuspicious: boolean; // conformity가 marginal/nonconform이면 true
  firstTwoDigits: BenfordDigitRow[]; // 첫 두 자리 10~99 (표본 충분 시)
  firstTwoMad: number | null;
  firstTwoConformity: BenfordConformity | null;
};

const BENFORD_MIN_SAMPLE_SIZE = 30;
// 첫 두 자리 검정은 구간이 90개라 표본이 더 많아야 의미가 있다.
const BENFORD_FIRST_TWO_MIN_SAMPLE = 300;
// 자유도 8, 유의수준 5%의 카이제곱 임계값(참고 표시용).
const BENFORD_CHI_SQUARE_CRITICAL = 15.51;

// Nigrini MAD 임계값 — 첫자리(9구간) / 첫 두 자리(90구간)
const MAD_FIRST_DIGIT = { close: 0.006, acceptable: 0.012, marginal: 0.015 };
const MAD_FIRST_TWO = { close: 0.0012, acceptable: 0.0018, marginal: 0.0022 };

function conformityFromMad(
  mad: number,
  cut: { close: number; acceptable: number; marginal: number }
): BenfordConformity {
  if (mad < cut.close) return "close";
  if (mad < cut.acceptable) return "acceptable";
  if (mad < cut.marginal) return "marginal";
  return "nonconform";
}

/** 거래금액 목록의 앞자리 분포를 벤포드 법칙과 비교한다. 첫자리(1~9)는 물론,
 * 표본이 충분하면(300건+) 포렌식 표준인 첫 두 자리(10~99) 검정까지 수행한다.
 * 판정은 카이제곱(표본 크면 과탐) 대신 표본크기에 무관한 MAD로 내린다. */
export function runBenfordTest(amounts: number[]): BenfordResult | null {
  const values = amounts.map((v) => Math.trunc(Math.abs(v))).filter((v) => v >= 1);
  if (values.length < BENFORD_MIN_SAMPLE_SIZE) return null;

  // ── 첫자리 (1~9) ──
  const counts = new Array(10).fill(0);
  for (const v of values) {
    const firstDigit = Number(String(v)[0]);
    if (firstDigit >= 1 && firstDigit <= 9) counts[firstDigit]++;
  }

  const n = values.length;
  let chiSquare = 0;
  let madSum = 0;
  const digits: BenfordDigitRow[] = [];
  for (let d = 1; d <= 9; d++) {
    const expectedProp = Math.log10(1 + 1 / d);
    const expectedCount = expectedProp * n;
    const actualProp = counts[d] / n;
    chiSquare += (counts[d] - expectedCount) ** 2 / expectedCount;
    madSum += Math.abs(actualProp - expectedProp);
    digits.push({
      digit: d,
      actualPercent: actualProp * 100,
      expectedPercent: expectedProp * 100,
      deviation: (actualProp - expectedProp) * 100,
    });
  }
  const mad = madSum / 9;
  const conformity = conformityFromMad(mad, MAD_FIRST_DIGIT);

  // ── 첫 두 자리 (10~99) — 표본 충분할 때만 ──
  const firstTwoDigits: BenfordDigitRow[] = [];
  let firstTwoMad: number | null = null;
  let firstTwoConformity: BenfordConformity | null = null;

  const twoDigitValues = values.filter((v) => v >= 10);
  if (twoDigitValues.length >= BENFORD_FIRST_TWO_MIN_SAMPLE) {
    const n2 = twoDigitValues.length;
    const counts2 = new Array(100).fill(0);
    for (const v of twoDigitValues) {
      const dd = Number(String(v).slice(0, 2));
      if (dd >= 10 && dd <= 99) counts2[dd]++;
    }
    let madSum2 = 0;
    for (let dd = 10; dd <= 99; dd++) {
      const expectedProp = Math.log10(1 + 1 / dd);
      const actualProp = counts2[dd] / n2;
      madSum2 += Math.abs(actualProp - expectedProp);
      firstTwoDigits.push({
        digit: dd,
        actualPercent: actualProp * 100,
        expectedPercent: expectedProp * 100,
        deviation: (actualProp - expectedProp) * 100,
      });
    }
    firstTwoMad = madSum2 / 90;
    firstTwoConformity = conformityFromMad(firstTwoMad, MAD_FIRST_TWO);
  }

  // 1차 판정: 첫자리 MAD가 경계/부적합이면 의심. (참고: 카이제곱 임계값도 함께 표시)
  const isSuspicious = conformity === "marginal" || conformity === "nonconform";

  return {
    sampleSize: n,
    digits,
    chiSquare,
    mad,
    conformity,
    isSuspicious,
    firstTwoDigits,
    firstTwoMad,
    firstTwoConformity,
  };
}

export const BENFORD_CHI_SQUARE_CRITICAL_VALUE = BENFORD_CHI_SQUARE_CRITICAL;

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
 * 5. 라운드트립(2자간 상계성 거래) 탐지
 * ──────────────────────────────────────────────────────────────── */

export type RoundTripFlag = {
  counterparty: string;
  /** 매출(수익) 인식 쪽 전표 */
  saleEntryNo: string;
  saleDate: string;
  saleAccount: string;
  saleAmount: number;
  /** 매입·자산취득(지출) 쪽 전표 */
  purchaseEntryNo: string;
  purchaseDate: string;
  purchaseAccount: string;
  purchaseAmount: number;
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

const normalizeAccount = (account: string) => account.replace(/\s/g, "");

/** 그 거래처에 "팔아서" 인식한 매출(수익)인가. 매출채권(정산 대상)·매출원가는
 * 매출이 아니므로 제외한다. */
function isRevenueAccount(account: string): boolean {
  const a = normalizeAccount(account);
  if (a.includes("매출채권") || a.includes("매출원가")) return false;
  return (
    a.includes("매출") ||
    a.includes("영업수익") ||
    a.includes("용역수익") ||
    a.includes("제품수익") ||
    a.includes("상품수익")
  );
}

/** 그 거래처로부터 "사들여" 발생한 매입·자산취득·용역비 등 지출인가. 매입채무·
 * 미지급금·차입금·현금·예금 같은 결제/재무 계정과, 이자·법인세·영업외/금융비용
 * 같은 순수 재무손익은 라운드트립 판단 대상이 아니므로 제외한다. */
function isPurchaseAccount(account: string): boolean {
  const a = normalizeAccount(account);
  if (
    a.includes("매입채무") ||
    a.includes("미지급") ||
    a.includes("차입") ||
    a.includes("현금") ||
    a.includes("예금") ||
    a.includes("이자") ||
    a.includes("법인세") ||
    a.includes("영업외") ||
    a.includes("금융비용")
  ) {
    return false;
  }
  return (
    a.includes("매입") ||
    a.includes("재고자산") ||
    a.includes("매출원가") ||
    a.includes("유형자산") ||
    a.includes("무형자산") ||
    a.includes("비품") ||
    a.includes("판매비") ||
    a.includes("관리비") ||
    a.includes("판관비") ||
    a.includes("수수료") ||
    a.includes("용역") ||
    a.includes("외주") ||
    a.includes("지급수수료")
  );
}

type RoundTripMarker = {
  entryNo: string;
  date: string;
  account: string;
  amount: number;
  time: number;
};

/**
 * 같은 거래처에 대해 "매출(팔았다)"과 "매입·자산취득(샀다)"이 짧은 기간 안에
 * 비슷한 금액으로 함께 존재하는지 찾는다 — 실질 없이 매출·매입을 서로 태워
 * 상계시키는 2자간 라운드트립(round-trip) 의심 패턴이다.
 *
 * 중요한 설계 두 가지:
 * 1. 거래 방향을 "전표 한 줄의 차/대변 부호"가 아니라 "계정과목의 성격"으로
 *    판정한다. 그래서 매출채권 회수(현금↔매출채권)나 매입채무 지급(매입채무↔
 *    현금) 같은 "정상적인 채권·채무 결제"는 매출도 매입도 아니어서 오탐으로
 *    잡히지 않는다. (예전 로직은 차/대변 부호만 봐서 정상 결제를 전부 순환거래로
 *    오탐했다.)
 * 2. 매출 1건을 매입 1건에만 매칭(1:1)해, 같은 거래가 여러 쌍으로 중복
 *    보고되지 않게 한다. 같은 전표(entryNo) 내 상계는 제외한다.
 *
 * 참고: 여러 회사를 거쳐 A→B→C→A로 되돌아오는 다자간 순환거래 그래프는 한
 * 회사의 전표만으로는 관측할 수 없으므로, 이 함수는 "2자간(거래처-당사)"
 * 라운드트립으로 범위를 한정한다.
 */
export function detectRoundTripTransactions(
  journalRows: JournalRow[]
): RoundTripFlag[] {
  const salesByCp = new Map<string, RoundTripMarker[]>();
  const purchasesByCp = new Map<string, RoundTripMarker[]>();

  for (const row of journalRows) {
    const cp = row.counterparty?.trim();
    if (!cp) continue;
    const time = parseJournalDate(row.date);
    if (time == null) continue;

    // 매출: 수익 계정이 대변(credit)에 잡힌 줄
    if (isRevenueAccount(row.account) && row.credit > row.debit && row.credit > 0) {
      if (!salesByCp.has(cp)) salesByCp.set(cp, []);
      salesByCp.get(cp)!.push({
        entryNo: row.entryNo,
        date: row.date,
        account: row.account,
        amount: row.credit,
        time,
      });
    }
    // 매입·지출: 매입/자산/비용 계정이 차변(debit)에 잡힌 줄
    else if (
      isPurchaseAccount(row.account) &&
      row.debit > row.credit &&
      row.debit > 0
    ) {
      if (!purchasesByCp.has(cp)) purchasesByCp.set(cp, []);
      purchasesByCp.get(cp)!.push({
        entryNo: row.entryNo,
        date: row.date,
        account: row.account,
        amount: row.debit,
        time,
      });
    }
  }

  const flags: RoundTripFlag[] = [];
  for (const [cp, sales] of salesByCp) {
    const purchases = purchasesByCp.get(cp);
    if (!purchases) continue; // 매출만 있고 매입이 없으면 라운드트립 아님

    const sortedSales = [...sales].sort((a, b) => a.time - b.time);
    const sortedPurchases = [...purchases].sort((a, b) => a.time - b.time);
    const usedPurchase = new Set<number>();

    for (const sale of sortedSales) {
      let bestIdx = -1;
      let bestDays = Infinity;
      for (let j = 0; j < sortedPurchases.length; j++) {
        if (usedPurchase.has(j)) continue;
        const purchase = sortedPurchases[j];
        // 같은 전표 내 상계는 제외
        if (sale.entryNo && purchase.entryNo && sale.entryNo === purchase.entryNo) {
          continue;
        }
        const diffRatio =
          Math.abs(sale.amount - purchase.amount) /
          Math.max(sale.amount, purchase.amount);
        if (diffRatio > ROUND_TRIP_AMOUNT_TOLERANCE) continue;
        const days = Math.abs(sale.time - purchase.time) / (1000 * 60 * 60 * 24);
        if (days > ROUND_TRIP_WINDOW_DAYS) continue;
        if (days < bestDays) {
          bestDays = days;
          bestIdx = j;
        }
      }
      if (bestIdx >= 0) {
        const purchase = sortedPurchases[bestIdx];
        usedPurchase.add(bestIdx);
        flags.push({
          counterparty: cp,
          saleEntryNo: sale.entryNo,
          saleDate: sale.date,
          saleAccount: sale.account,
          saleAmount: sale.amount,
          purchaseEntryNo: purchase.entryNo,
          purchaseDate: purchase.date,
          purchaseAccount: purchase.account,
          purchaseAmount: purchase.amount,
          daysApart: Math.round(bestDays),
        });
      }
    }
  }

  return flags.sort((a, b) => a.daysApart - b.daysApart);
}
