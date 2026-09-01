import { describe, expect, it } from "vitest";
import {
  BENCHMARKS,
  CTT_RATE,
  PM_RATES,
  calculateMateriality,
  readBenchmarkAmount,
} from "../materiality";
import type { NormalizedFinancials, StatementRow } from "../financials";

const row = (account: string, prior: number, current: number): StatementRow => ({
  account,
  prior,
  current,
});

describe("calculateMateriality — ISA 320 3단 산정", () => {
  it("전반중요성 = 벤치마크 × 적용률", () => {
    const result = calculateMateriality({
      benchmark: "매출액",
      benchmarkAmount: 10_000_000_000,
      rate: 0.5,
      risk: "normal",
    })!;
    expect(result.overall).toBe(50_000_000);
  });

  it("수행중요성은 위험이 높을수록 낮게 잡아 여유를 크게 둔다", () => {
    const input = {
      benchmark: "매출액" as const,
      benchmarkAmount: 10_000_000_000,
      rate: 0.5,
    };
    const normal = calculateMateriality({ ...input, risk: "normal" })!;
    const high = calculateMateriality({ ...input, risk: "high" })!;

    expect(normal.pmRate).toBe(75);
    expect(normal.performance).toBe(37_500_000);
    expect(high.pmRate).toBe(50);
    expect(high.performance).toBe(25_000_000);
    expect(high.performance).toBeLessThan(normal.performance);
  });

  it("명백히 사소한 기준은 전반중요성의 5%", () => {
    const result = calculateMateriality({
      benchmark: "자산총계",
      benchmarkAmount: 1_000_000_000,
      rate: 1,
      risk: "normal",
    })!;
    expect(result.overall).toBe(10_000_000);
    expect(result.clearlyTrivial).toBe(500_000);
    expect(CTT_RATE).toBe(5);
  });

  it("벤치마크가 0 이하면 산정할 수 없다 (적자·자본잠식)", () => {
    const input = { benchmark: "법인세차감전순이익" as const, rate: 5, risk: "normal" as const };
    expect(calculateMateriality({ ...input, benchmarkAmount: 0 })).toBeNull();
    expect(calculateMateriality({ ...input, benchmarkAmount: -1_000 })).toBeNull();
  });

  it("적용률이 0 이하거나 숫자가 아니면 null", () => {
    const input = {
      benchmark: "매출액" as const,
      benchmarkAmount: 1_000_000,
      risk: "normal" as const,
    };
    expect(calculateMateriality({ ...input, rate: 0 })).toBeNull();
    expect(calculateMateriality({ ...input, rate: Number.NaN })).toBeNull();
  });
});

describe("BENCHMARKS 정의", () => {
  it("네 가지 벤치마크에 실무 통용 적용률 범위가 붙어 있다", () => {
    expect(BENCHMARKS.map((b) => b.key)).toEqual([
      "법인세차감전순이익",
      "매출액",
      "자산총계",
      "자본총계",
    ]);
  });

  it("기본 제시값은 항상 허용범위 안에 있다", () => {
    for (const b of BENCHMARKS) {
      expect(b.defaultRate).toBeGreaterThanOrEqual(b.minRate);
      expect(b.defaultRate).toBeLessThanOrEqual(b.maxRate);
      expect(b.guidance.length).toBeGreaterThan(0);
    }
  });

  it("수행중요성률은 high가 normal보다 낮다", () => {
    expect(PM_RATES.high.rate).toBeLessThan(PM_RATES.normal.rate);
  });
});

describe("readBenchmarkAmount — 재무제표에서 자동 채우기", () => {
  const financials: NormalizedFinancials = {
    bs: [row("자산총계", 900, 1000), row("자본총계", 600, 700)],
    is: [
      row("매출액", 4000, 5000),
      row("당기순이익", 200, 300),
      row("법인세비용", 40, 60),
    ],
  };

  it("자산총계·자본총계·매출액은 당기 금액을 그대로 읽는다", () => {
    expect(readBenchmarkAmount(financials, "자산총계")).toBe(1000);
    expect(readBenchmarkAmount(financials, "자본총계")).toBe(700);
    expect(readBenchmarkAmount(financials, "매출액")).toBe(5000);
  });

  it("법인세차감전순이익은 당기순이익 + 법인세비용으로 역산한다", () => {
    // 별도 계정으로 잡히지 않는 경우가 많다.
    expect(readBenchmarkAmount(financials, "법인세차감전순이익")).toBe(360);
  });

  it("법인세비용이 없으면 당기순이익만 쓴다", () => {
    expect(
      readBenchmarkAmount(
        { bs: [], is: [row("당기순이익", 0, 300)] },
        "법인세차감전순이익"
      )
    ).toBe(300);
  });

  it("적자여도 절대값을 씌우지 않고 그대로 돌려준다 (호출부가 경고)", () => {
    expect(
      readBenchmarkAmount(
        { bs: [], is: [row("당기순이익", 0, -500), row("법인세비용", 0, 0)] },
        "법인세차감전순이익"
      )
    ).toBe(-500);
  });

  it("계정이 없으면 null", () => {
    expect(readBenchmarkAmount({ bs: [], is: [] }, "자산총계")).toBeNull();
    expect(readBenchmarkAmount({ bs: [], is: [] }, "법인세차감전순이익")).toBeNull();
  });
});
