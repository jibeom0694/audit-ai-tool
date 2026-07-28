import type { NormalizedFinancials } from "./financials";
import { findAccountValue } from "./financials";

// ISA 320(감사계획수립과 감사수행에 있어서의 중요성) 기반 중요성 산정.
//
// 중요성은 감사의 출발점이다. 어느 계정을 얼마나 파고들지, 표본을 몇 개 뽑을지,
// 발견한 왜곡을 넘길지 말지가 전부 여기서 나온다. 그래서 이 값은 조서(중요성
// 기준란)와 MUS(허용왜곡금액), 미수정왜곡사항 집계표(SUM)로 함께 흘러간다.
//
// 세 단계로 계산한다:
//   1) 전반중요성(OM)   = 벤치마크 × 적용률
//   2) 수행중요성(PM)   = OM × 수행중요성률(위험이 높을수록 낮게)
//   3) 명백히 사소한 기준(CTT) = OM × 5% — 이보다 작은 왜곡은 집계도 하지 않는다
//
// 적용률은 기준서가 숫자를 못박지 않고 "감사인의 판단"으로 두므로, 실무에서
// 통용되는 범위를 제시하고 사용자가 그 안에서 고르게 한다(근거를 남기기 위함).

export type BenchmarkKey =
  | "법인세차감전순이익"
  | "매출액"
  | "자산총계"
  | "자본총계";

export type BenchmarkOption = {
  key: BenchmarkKey;
  label: string;
  /** 실무에서 통용되는 적용률 범위(%) */
  minRate: number;
  maxRate: number;
  /** 기본 제시값(%) */
  defaultRate: number;
  /** 이 벤치마크를 언제 쓰는지 */
  guidance: string;
};

export const BENCHMARKS: BenchmarkOption[] = [
  {
    key: "법인세차감전순이익",
    label: "법인세차감전순이익",
    minRate: 5,
    maxRate: 10,
    defaultRate: 5,
    guidance:
      "이익이 안정적인 영리기업의 가장 일반적인 기준. 이익이 적자이거나 해마다 크게 출렁이면 왜곡된 값이 나오므로 다른 기준을 쓴다.",
  },
  {
    key: "매출액",
    label: "매출액",
    minRate: 0.5,
    maxRate: 1,
    defaultRate: 0.5,
    guidance:
      "손익이 손익분기점 근처이거나 적자라 이익 기준이 부적절할 때. 성장기업·매출 규모가 안정적인 기업에 적합하다.",
  },
  {
    key: "자산총계",
    label: "자산총계",
    minRate: 1,
    maxRate: 2,
    defaultRate: 1,
    guidance:
      "자산 보유가 사업의 핵심인 경우(투자·부동산·금융업 등). 이용자의 관심이 손익보다 자산 규모에 있을 때.",
  },
  {
    key: "자본총계",
    label: "자본총계",
    minRate: 1,
    maxRate: 5,
    defaultRate: 2,
    guidance:
      "자본 건전성이 이용자의 주된 관심사인 경우. 자본잠식 기업에는 적합하지 않다.",
  },
];

/** 수행중요성 비율. 위험이 높다고 볼수록 낮게 잡아 여유(buffer)를 크게 둔다. */
export type RiskLevel = "high" | "normal";

export const PM_RATES: Record<RiskLevel, { rate: number; label: string; note: string }> = {
  high: {
    rate: 50,
    label: "높음",
    note: "전기 수정사항이 많거나 내부통제 미비·부정위험이 식별된 경우",
  },
  normal: {
    rate: 75,
    label: "보통",
    note: "전기 수정사항이 적고 통제가 유효하게 운영되는 경우",
  },
};

/** 명백히 사소한 기준(CTT)은 전반중요성의 5%로 둔다(실무 통용범위 3~5%). */
export const CTT_RATE = 5;

export type MaterialityInput = {
  benchmark: BenchmarkKey;
  /** 벤치마크 금액(원). 재무제표에서 자동으로 채우되 사용자가 덮어쓸 수 있다. */
  benchmarkAmount: number;
  /** 적용률(%) */
  rate: number;
  risk: RiskLevel;
};

export type MaterialityResult = {
  /** 전반중요성 */
  overall: number;
  /** 수행중요성 */
  performance: number;
  /** 명백히 사소한 기준 */
  clearlyTrivial: number;
  pmRate: number;
};

export function calculateMateriality(
  input: MaterialityInput
): MaterialityResult | null {
  const { benchmarkAmount, rate, risk } = input;
  if (!Number.isFinite(benchmarkAmount) || benchmarkAmount <= 0) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const overall = benchmarkAmount * (rate / 100);
  const pmRate = PM_RATES[risk].rate;
  return {
    overall,
    performance: overall * (pmRate / 100),
    clearlyTrivial: overall * (CTT_RATE / 100),
    pmRate,
  };
}

/**
 * 재무제표에서 벤치마크 금액을 뽑는다. 법인세차감전순이익은 별도 계정으로
 * 잡히지 않는 경우가 많아 당기순이익 + 법인세비용으로 역산한다. 손익 항목은
 * 음수(적자)일 수 있으므로 절대값을 쓰지 않고 그대로 돌려주고, 적자 여부는
 * 호출부가 판단해 경고한다.
 */
export function readBenchmarkAmount(
  financials: NormalizedFinancials,
  key: BenchmarkKey
): number | null {
  const bs = financials.bs;
  const is = financials.is;
  switch (key) {
    case "자산총계":
      return findAccountValue(bs, "자산총계", "current");
    case "자본총계":
      return findAccountValue(bs, "자본총계", "current");
    case "매출액":
      return findAccountValue(is, "매출액", "current");
    case "법인세차감전순이익": {
      const net = findAccountValue(is, "당기순이익", "current");
      if (net == null) return null;
      const tax = findAccountValue(is, "법인세비용", "current");
      return tax == null ? net : net + tax;
    }
  }
}
