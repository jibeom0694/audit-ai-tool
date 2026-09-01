import { describe, expect, it } from "vitest";
import { calculateMusSampleSize, isMusEligibleAccount } from "../musSampling";

// 표본크기 = (신뢰요소 × 모집단) ÷ (허용왜곡 − 예상오류금액 × 확장계수)

describe("calculateMusSampleSize", () => {
  const base = {
    confidenceLevel: 95 as const,
    populationAmount: 1_000_000_000,
    tolerableMisstatement: 50_000_000,
    expectedMisstatementRate: 0,
  };

  it("예상오류가 0이면 신뢰요소 ÷ 허용왜곡 비율 그대로다", () => {
    const result = calculateMusSampleSize(base)!;
    expect(result.reliabilityFactor).toBe(3.0);
    expect(result.sampleSize).toBe(60); // 3.0 × 10억 ÷ 5천만
    expect(result.samplingInterval).toBeCloseTo(1_000_000_000 / 60, 6);
  });

  it("예상오류가 있으면 확장계수를 곱해 허용왜곡을 깎는다 → 표본이 커진다", () => {
    const result = calculateMusSampleSize({
      ...base,
      expectedMisstatementRate: 1,
    })!;
    expect(result.expectedMisstatementAmount).toBe(10_000_000);
    expect(result.expansionFactor).toBe(1.6);
    expect(result.adjustedTolerableMisstatement).toBe(34_000_000);
    expect(result.sampleSize).toBe(89); // ceil(3.0 × 10억 ÷ 3,400만)
  });

  it("신뢰수준이 높을수록 표본이 커진다", () => {
    const at90 = calculateMusSampleSize({ ...base, confidenceLevel: 90 })!;
    const at95 = calculateMusSampleSize({ ...base, confidenceLevel: 95 })!;
    const at99 = calculateMusSampleSize({ ...base, confidenceLevel: 99 })!;
    expect(at90.reliabilityFactor).toBe(2.31);
    expect(at99.reliabilityFactor).toBe(4.61);
    expect(at90.sampleSize).toBeLessThan(at95.sampleSize);
    expect(at95.sampleSize).toBeLessThan(at99.sampleSize);
  });

  it("99% 확장계수는 AICPA 표값 1.9다", () => {
    // 과거 2.0으로 잘못 넣었던 값. 표본크기가 과대 산출되던 원인이다.
    const result = calculateMusSampleSize({
      ...base,
      confidenceLevel: 99,
      expectedMisstatementRate: 1,
    })!;
    expect(result.expansionFactor).toBe(1.9);
  });

  it("표본크기는 올림한다 (0.1개를 뽑을 수는 없다)", () => {
    const result = calculateMusSampleSize({
      ...base,
      tolerableMisstatement: 49_000_000,
    })!;
    expect(Number.isInteger(result.sampleSize)).toBe(true);
    expect(result.sampleSize).toBe(62); // ceil(61.22...)
  });

  it("예상오류가 허용왜곡을 다 먹으면 표본설계가 성립하지 않는다", () => {
    expect(
      calculateMusSampleSize({ ...base, expectedMisstatementRate: 10 })
    ).toBeNull();
  });

  it("모집단이나 허용왜곡이 0 이하면 계산하지 않는다", () => {
    expect(calculateMusSampleSize({ ...base, populationAmount: 0 })).toBeNull();
    expect(
      calculateMusSampleSize({ ...base, tolerableMisstatement: 0 })
    ).toBeNull();
  });
});

describe("계통추출 표본항목", () => {
  it("추출간격의 절반에서 시작해 간격만큼 건너뛴다", () => {
    const result = calculateMusSampleSize({
      confidenceLevel: 95,
      populationAmount: 1_000_000,
      tolerableMisstatement: 300_000,
      expectedMisstatementRate: 0,
    })!;
    expect(result.sampleSize).toBe(10);
    const interval = 100_000;
    expect(result.sampleTags[0]).toBe(interval / 2);
    expect(result.sampleTags[1]).toBe(interval / 2 + interval);
    expect(result.sampleTags).toHaveLength(10);
    expect(result.isCappedPreview).toBe(false);
  });

  it("표본이 20개를 넘으면 미리보기는 20개까지만 (전체 크기는 그대로)", () => {
    const result = calculateMusSampleSize({
      confidenceLevel: 95,
      populationAmount: 1_000_000_000,
      tolerableMisstatement: 50_000_000,
      expectedMisstatementRate: 0,
    })!;
    expect(result.sampleSize).toBe(60);
    expect(result.sampleTags).toHaveLength(20);
    expect(result.isCappedPreview).toBe(true);
  });
});

describe("isMusEligibleAccount", () => {
  it("실사·조회할 거래가 여러 건인 계정은 모집단이 될 수 있다", () => {
    for (const account of ["재고자산", "매출채권", "매입채무", "유형자산"]) {
      expect(isMusEligibleAccount(account)).toBe(true);
    }
  });

  it("소계·총계는 다른 계정의 합이라 모집단이 아니다", () => {
    for (const account of ["자산총계", "유동자산", "부채총계", "자본총계"]) {
      expect(isMusEligibleAccount(account)).toBe(false);
    }
  });

  it("자본 항목은 계약서·등기 확인 대상이지 표본추출 대상이 아니다", () => {
    for (const account of ["자본금", "이익잉여금", "주식발행초과금"]) {
      expect(isMusEligibleAccount(account)).toBe(false);
    }
  });

  it("손익 소계·주당지표는 계산 결과이지 거래 모집단이 아니다", () => {
    for (const account of ["매출총이익", "영업이익", "당기순이익", "기본주당이익"]) {
      expect(isMusEligibleAccount(account)).toBe(false);
    }
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(isMusEligibleAccount("  자산총계  ")).toBe(false);
    expect(isMusEligibleAccount("  재고자산  ")).toBe(true);
  });
});
