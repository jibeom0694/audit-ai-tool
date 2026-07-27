import {
  findAccountRow,
  findAccountValue,
  type NormalizedFinancials,
  type StatementRow,
} from "./financials";

export type Ratio = {
  label: string;
  value: number | null;
  unit: "%" | "배" | "원";
  formula: string;
};

export type RatioGroup = {
  category: "유동성" | "수익성" | "성장성" | "안정성";
  ratios: Ratio[];
};

export type AccountChange = {
  account: string;
  prior: number;
  current: number;
  changeRate: number | null;
  absoluteChange: number;
  isAbnormal: boolean;
  /** 전기 0 → 당기 발생한 신규 계정(증감률이 정의되지 않음). ISA 520 관점에서
   * 새로 생긴 잔액은 별도 검토 대상이라 UI에서 "신규"로 구분 표시한다. */
  isNew: boolean;
};

export type CrossCheckFlag = {
  label: string;
  detail: string;
};

const DEFAULT_THRESHOLD_PERCENT = 20;

function safePercent(
  numerator: number | null,
  denominator: number | null
): number | null {
  if (numerator == null || denominator == null || denominator === 0) {
    return null;
  }
  return (numerator / denominator) * 100;
}

function safeMultiple(
  numerator: number | null,
  denominator: number | null
): number | null {
  if (numerator == null || denominator == null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function safeGrowth(
  current: number | null,
  prior: number | null
): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

/** 재무비율을 유동성/수익성/성장성/안정성 4개 그룹으로 계산한다. */
export function calculateRatios(financials: NormalizedFinancials): RatioGroup[] {
  const { bs, is } = financials;

  const 유동자산 = findAccountValue(bs, "유동자산", "current");
  const 유동부채 = findAccountValue(bs, "유동부채", "current");
  const 재고자산 = findAccountValue(bs, "재고자산", "current");
  const 자산총계_당기 = findAccountValue(bs, "자산총계", "current");
  const 자산총계_전기 = findAccountValue(bs, "자산총계", "prior");
  const 부채총계_당기 = findAccountValue(bs, "부채총계", "current");
  const 자본총계_당기 = findAccountValue(bs, "자본총계", "current");

  const 매출액_당기 = findAccountValue(is, "매출액", "current");
  const 매출액_전기 = findAccountValue(is, "매출액", "prior");
  const 매출원가_당기 = findAccountValue(is, "매출원가", "current");
  let 매출총이익_당기 = findAccountValue(is, "매출총이익", "current");
  if (매출총이익_당기 == null && 매출액_당기 != null && 매출원가_당기 != null) {
    매출총이익_당기 = 매출액_당기 - 매출원가_당기;
  }
  const 영업이익_당기 = findAccountValue(is, "영업이익", "current");
  const 이자비용_당기 = findAccountValue(is, "이자비용", "current");
  const 당기순이익_당기 = findAccountValue(is, "당기순이익", "current");
  const 당기순이익_전기 = findAccountValue(is, "당기순이익", "prior");

  return [
    {
      category: "유동성",
      ratios: [
        {
          label: "유동비율",
          value: safePercent(유동자산, 유동부채),
          unit: "%",
          formula: "유동자산 ÷ 유동부채 × 100",
        },
        {
          label: "당좌비율",
          value:
            유동자산 != null && 재고자산 != null
              ? safePercent(유동자산 - 재고자산, 유동부채)
              : null,
          unit: "%",
          formula: "(유동자산 − 재고자산) ÷ 유동부채 × 100",
        },
      ],
    },
    {
      category: "수익성",
      ratios: [
        {
          label: "매출총이익률",
          value: safePercent(매출총이익_당기, 매출액_당기),
          unit: "%",
          formula: "매출총이익 ÷ 매출액 × 100",
        },
        {
          label: "영업이익률",
          value: safePercent(영업이익_당기, 매출액_당기),
          unit: "%",
          formula: "영업이익 ÷ 매출액 × 100",
        },
        {
          label: "순이익률",
          value: safePercent(당기순이익_당기, 매출액_당기),
          unit: "%",
          formula: "당기순이익 ÷ 매출액 × 100",
        },
        {
          label: "총자산순이익률(ROA)",
          value: safePercent(당기순이익_당기, 자산총계_당기),
          unit: "%",
          formula: "당기순이익 ÷ 자산총계 × 100",
        },
        {
          label: "자기자본순이익률(ROE)",
          value: safePercent(당기순이익_당기, 자본총계_당기),
          unit: "%",
          formula: "당기순이익 ÷ 자본총계 × 100",
        },
      ],
    },
    {
      category: "성장성",
      ratios: [
        {
          label: "매출액증가율",
          value: safeGrowth(매출액_당기, 매출액_전기),
          unit: "%",
          formula: "(매출액_당기 − 매출액_전기) ÷ |매출액_전기| × 100",
        },
        {
          label: "총자산증가율",
          value: safeGrowth(자산총계_당기, 자산총계_전기),
          unit: "%",
          formula: "(자산총계_당기 − 자산총계_전기) ÷ |자산총계_전기| × 100",
        },
        {
          label: "순이익증가율",
          value: safeGrowth(당기순이익_당기, 당기순이익_전기),
          unit: "%",
          formula: "(당기순이익_당기 − 당기순이익_전기) ÷ |당기순이익_전기| × 100",
        },
      ],
    },
    {
      category: "안정성",
      ratios: [
        {
          label: "부채비율",
          value: safePercent(부채총계_당기, 자본총계_당기),
          unit: "%",
          formula: "부채총계 ÷ 자본총계 × 100",
        },
        {
          label: "이자보상배율",
          value: safeMultiple(영업이익_당기, 이자비용_당기),
          unit: "배",
          formula: "영업이익 ÷ 이자비용",
        },
      ],
    },
  ];
}

/** 주당 가치평가 지표(EPS/BPS/PER/PBR)를 계산한다. DART는 발행주식수를
 * fnlttSinglAcntAll로 내려주지 않으므로, 공시된 기본주당이익(EPS)과
 * 당기순이익으로 발행주식수를 역산해 BPS를 추정한다(가중평균 발행주식수
 * 기준이라 근사치임). PER/PBR은 사용자가 입력한 주가가 있어야 계산되며,
 * 비상장기업처럼 EPS 공시가 없는 입력 경로에서는 전부 데이터 부족으로 표시된다. */
export function calculateValuationRatios(
  financials: NormalizedFinancials,
  stockPrice: number | null
): Ratio[] {
  const { bs, is } = financials;

  const eps = findAccountValue(is, "기본주당이익", "current");
  const 당기순이익_당기 = findAccountValue(is, "당기순이익", "current");
  const 자본총계_당기 = findAccountValue(bs, "자본총계", "current");

  let bps: number | null = null;
  if (eps != null && eps !== 0 && 당기순이익_당기 != null && 자본총계_당기 != null) {
    const impliedShares = 당기순이익_당기 / eps;
    if (impliedShares !== 0) bps = 자본총계_당기 / impliedShares;
  }

  const per = stockPrice != null && eps != null && eps !== 0 ? stockPrice / eps : null;
  const pbr = stockPrice != null && bps != null && bps !== 0 ? stockPrice / bps : null;

  return [
    {
      label: "주당순이익(EPS)",
      value: eps,
      unit: "원",
      formula: "공시된 기본주당이익",
    },
    {
      label: "주당순자산(BPS)",
      value: bps,
      unit: "원",
      formula: "자본총계 ÷ 추정 발행주식수(당기순이익 ÷ EPS)",
    },
    {
      label: "주가수익비율(PER)",
      value: per,
      unit: "배",
      formula: "입력한 주가 ÷ EPS",
    },
    {
      label: "주가순자산비율(PBR)",
      value: pbr,
      unit: "배",
      formula: "입력한 주가 ÷ BPS",
    },
  ];
}

/** 재무상태표/손익계산서의 모든 계정에 대해 전기 대비 증감률을 계산하고, 임계치
 * 이상이면 이상 변동으로 표시한다. */
export function calculateAccountChanges(
  rows: StatementRow[],
  thresholdPercent: number = DEFAULT_THRESHOLD_PERCENT,
  materialityAmount: number = 0
): AccountChange[] {
  return rows.map((r) => {
    const changeRate = r.prior !== 0 ? ((r.current - r.prior) / Math.abs(r.prior)) * 100 : null;
    const absoluteChange = Math.abs(r.current - r.prior);
    // 전기 0 → 당기 발생: 증감률(%)이 정의되지 않아 기존 로직에선 절대 이상으로
    // 잡히지 않았다. 그러나 새로 생긴 잔액이야말로 ISA 520 분석적 검토가 놓치면
    // 안 되는 대상이므로, 신규 계정으로 표시하고 중요성 게이트를 통과하면 이상으로 본다.
    const isNew = r.prior === 0 && r.current !== 0;
    const meetsPercentThreshold =
      changeRate != null && Math.abs(changeRate) >= thresholdPercent;
    const meetsMateriality =
      materialityAmount <= 0 || absoluteChange >= materialityAmount;
    const isAbnormal = meetsMateriality && (meetsPercentThreshold || isNew);
    return {
      account: r.account,
      prior: r.prior,
      current: r.current,
      changeRate,
      absoluteChange,
      isAbnormal,
      isNew,
    };
  });
}

/** 매출 증가율 대비 매출채권 증가율이 비정상적으로 높은 경우 등, 계정 간
 * 교차검증 규칙을 적용해 위험 신호를 뽑아낸다. */
export function crossCheckAccounts(
  financials: NormalizedFinancials
): CrossCheckFlag[] {
  const { bs, is } = financials;
  const flags: CrossCheckFlag[] = [];

  const revenueGrowth = safeGrowth(
    findAccountValue(is, "매출액", "current"),
    findAccountValue(is, "매출액", "prior")
  );
  const receivablesRow = findAccountRow(bs, "매출채권");
  const receivablesGrowth = receivablesRow
    ? safeGrowth(receivablesRow.current, receivablesRow.prior)
    : null;

  if (
    revenueGrowth != null &&
    receivablesGrowth != null &&
    receivablesGrowth - revenueGrowth >= DEFAULT_THRESHOLD_PERCENT
  ) {
    flags.push({
      label: "매출채권 증가율이 매출 증가율보다 비정상적으로 높음",
      detail: `매출 증가율 ${revenueGrowth.toFixed(1)}% 대비 매출채권 증가율 ${receivablesGrowth.toFixed(1)}% — 허위매출 가능성 검토 필요`,
    });
  }

  const inventoryRow = findAccountRow(bs, "재고자산");
  const inventoryGrowth = inventoryRow
    ? safeGrowth(inventoryRow.current, inventoryRow.prior)
    : null;

  if (
    revenueGrowth != null &&
    inventoryGrowth != null &&
    inventoryGrowth - revenueGrowth >= DEFAULT_THRESHOLD_PERCENT
  ) {
    flags.push({
      label: "재고자산 증가율이 매출 증가율보다 비정상적으로 높음",
      detail: `매출 증가율 ${revenueGrowth.toFixed(1)}% 대비 재고자산 증가율 ${inventoryGrowth.toFixed(1)}% — 재고 진부화·평가손실 위험 검토 필요`,
    });
  }

  return flags;
}
