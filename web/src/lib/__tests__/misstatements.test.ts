import { describe, expect, it } from "vitest";
import {
  MISSTATEMENT_TYPE_LABELS,
  summarizeMisstatements,
  type Misstatement,
} from "../misstatements";

// ISA 450 — 개별로는 사소해 보이는 왜곡도 합치면 중요성을 넘을 수 있다.
// incomeEffect: 양수 = 이익 과대계상, 음수 = 이익 과소계상.

const item = (over: Partial<Misstatement>): Misstatement => ({
  id: "m1",
  description: "매출 과대계상",
  type: "factual",
  incomeEffect: 0,
  corrected: false,
  source: "manual",
  ...over,
});

const OM = 50_000_000;
const CTT = 2_500_000;

describe("summarizeMisstatements — 집계", () => {
  it("미수정 왜곡만 합계 대상이다", () => {
    const result = summarizeMisstatements(
      [
        item({ id: "a", incomeEffect: 30_000_000 }),
        item({ id: "b", incomeEffect: 20_000_000, corrected: true }),
      ],
      OM,
      CTT
    );
    expect(result.uncorrectedCount).toBe(1);
    expect(result.netUncorrected).toBe(30_000_000);
    expect(result.correctedTotal).toBe(20_000_000);
  });

  it("순합계는 과대·과소가 서로 상계된다", () => {
    const result = summarizeMisstatements(
      [
        item({ id: "a", incomeEffect: 30_000_000 }),
        item({ id: "b", incomeEffect: -25_000_000 }),
      ],
      OM,
      CTT
    );
    expect(result.netUncorrected).toBe(5_000_000);
  });

  it("총합계는 상계에 기대지 않고 절대값을 더한다", () => {
    // 상계로 순액이 작아 보여도 왜곡의 총규모는 따로 봐야 한다.
    const result = summarizeMisstatements(
      [
        item({ id: "a", incomeEffect: 30_000_000 }),
        item({ id: "b", incomeEffect: -25_000_000 }),
      ],
      OM,
      CTT
    );
    expect(result.grossUncorrected).toBe(55_000_000);
  });

  it("수정된 항목의 합계도 절대값으로 본다", () => {
    const result = summarizeMisstatements(
      [
        item({ id: "a", incomeEffect: -10_000_000, corrected: true }),
        item({ id: "b", incomeEffect: 4_000_000, corrected: true }),
      ],
      OM,
      CTT
    );
    expect(result.correctedTotal).toBe(14_000_000);
    expect(result.uncorrectedCount).toBe(0);
  });
});

describe("summarizeMisstatements — 중요성 판정", () => {
  it("순합계가 전반중요성을 넘으면 재무제표가 중요하게 왜곡된 것", () => {
    const result = summarizeMisstatements(
      [
        item({ id: "a", incomeEffect: 30_000_000 }),
        item({ id: "b", incomeEffect: 25_000_000 }),
      ],
      OM,
      CTT
    );
    expect(result.netUncorrected).toBe(55_000_000);
    expect(result.exceedsOverall).toBe(true);
  });

  it("개별 항목이 전반중요성을 넘으면 따로 표시한다", () => {
    const result = summarizeMisstatements(
      [
        item({ id: "a", incomeEffect: 60_000_000 }),
        item({ id: "b", incomeEffect: -55_000_000 }),
      ],
      OM,
      CTT
    );
    // 순액은 500만원으로 작지만, 개별로 6천만원짜리 왜곡이 있다.
    expect(result.exceedsOverall).toBe(false);
    expect(result.hasIndividuallyMaterial).toBe(true);
  });

  it("과소계상(음수)도 절대값으로 판단한다", () => {
    const result = summarizeMisstatements(
      [item({ id: "a", incomeEffect: -60_000_000 })],
      OM,
      CTT
    );
    expect(result.exceedsOverall).toBe(true);
    expect(result.hasIndividuallyMaterial).toBe(true);
  });

  it("중요성이 아직 산정되지 않았으면 판정하지 않는다", () => {
    const result = summarizeMisstatements(
      [item({ id: "a", incomeEffect: 999_000_000 })],
      0,
      0
    );
    expect(result.exceedsOverall).toBe(false);
    expect(result.hasIndividuallyMaterial).toBe(false);
  });

  it("명백히 사소한 기준 미만 항목 수를 따로 센다", () => {
    const result = summarizeMisstatements(
      [
        item({ id: "a", incomeEffect: 1_000_000 }), // CTT 미만
        item({ id: "b", incomeEffect: -2_000_000 }), // CTT 미만
        item({ id: "c", incomeEffect: 10_000_000 }),
      ],
      OM,
      CTT
    );
    expect(result.belowThresholdCount).toBe(2);
  });

  it("CTT가 0이면 사소 판정을 하지 않는다", () => {
    const result = summarizeMisstatements(
      [item({ id: "a", incomeEffect: 1 })],
      OM,
      0
    );
    expect(result.belowThresholdCount).toBe(0);
  });
});

describe("왜곡 유형", () => {
  it("사실·판단·추정 세 유형에 설명이 붙어 있다", () => {
    expect(Object.keys(MISSTATEMENT_TYPE_LABELS)).toEqual([
      "factual",
      "judgmental",
      "projected",
    ]);
    for (const v of Object.values(MISSTATEMENT_TYPE_LABELS)) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.note.length).toBeGreaterThan(0);
    }
  });

  it("빈 목록도 안전하게 처리한다", () => {
    const result = summarizeMisstatements([], OM, CTT);
    expect(result).toMatchObject({
      netUncorrected: 0,
      grossUncorrected: 0,
      correctedTotal: 0,
      uncorrectedCount: 0,
      exceedsOverall: false,
      hasIndividuallyMaterial: false,
    });
  });
});
