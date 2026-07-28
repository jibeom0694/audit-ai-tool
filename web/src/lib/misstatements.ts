// ISA 450(감사 중 식별된 왜곡표시의 평가) 기반 미수정왜곡사항 집계표(SUM).
//
// 감사 결론은 결국 여기서 나온다. 개별로는 사소해 보이는 왜곡도 합치면
// 중요성을 넘을 수 있어서, 발견한 왜곡을 한 곳에 모아 합계를 전반중요성과
// 비교하는 절차가 필요하다.
//
// 주의 — 전표(JE) 테스트의 예외항목은 여기에 자동으로 들어오지 않는다.
// "주말에 전기됐다"는 조사 대상 신호이지 확인된 왜곡금액이 아니다. 감사인이
// 실제로 조사해 왜곡으로 확정한 것만 항목으로 추가해야 한다. 반면 시산표
// roll-forward 불일치는 장부 자체의 확인된 차이라서 사실왜곡 후보로 제안한다.

export type MisstatementType = "factual" | "judgmental" | "projected";

export const MISSTATEMENT_TYPE_LABELS: Record<
  MisstatementType,
  { label: string; note: string }
> = {
  factual: {
    label: "사실왜곡",
    note: "의문의 여지 없이 확인된 오류(계산 착오, 기표 누락 등)",
  },
  judgmental: {
    label: "판단왜곡",
    note: "경영진의 추정·회계정책 판단과 감사인의 견해 차이",
  },
  projected: {
    label: "추정왜곡",
    note: "표본에서 발견한 왜곡을 모집단 전체로 확대추정한 금액",
  },
};

export type Misstatement = {
  id: string;
  description: string;
  type: MisstatementType;
  /** 세전이익에 미치는 영향(원). 양수 = 이익 과대계상, 음수 = 이익 과소계상. */
  incomeEffect: number;
  /** 경영진이 수정했으면 true. 미수정분만 합계 평가 대상이 된다. */
  corrected: boolean;
  /** 시산표 검증에서 자동 제안된 항목인지 표시(감사인이 확정하기 전 구분용). */
  source: "manual" | "trialBalance";
};

export type MisstatementSummary = {
  /** 미수정 왜곡의 순합계(상계 후). 이익 과대·과소가 서로 상쇄된다. */
  netUncorrected: number;
  /** 미수정 왜곡의 절대값 합계. 상계에 기대지 않고 총규모를 보는 값. */
  grossUncorrected: number;
  correctedTotal: number;
  uncorrectedCount: number;
  /** 명백히 사소한 기준(CTT) 미만이라 집계에서 빼도 되는 항목 수. */
  belowThresholdCount: number;
  /** 순합계가 전반중요성을 넘는가 — 넘으면 재무제표가 중요하게 왜곡된 것. */
  exceedsOverall: boolean;
  /** 개별로 전반중요성을 넘는 항목이 있는가. */
  hasIndividuallyMaterial: boolean;
};

export function summarizeMisstatements(
  items: Misstatement[],
  overallMateriality: number,
  clearlyTrivial: number
): MisstatementSummary {
  const uncorrected = items.filter((i) => !i.corrected);
  const netUncorrected = uncorrected.reduce((s, i) => s + i.incomeEffect, 0);
  const grossUncorrected = uncorrected.reduce(
    (s, i) => s + Math.abs(i.incomeEffect),
    0
  );
  const correctedTotal = items
    .filter((i) => i.corrected)
    .reduce((s, i) => s + Math.abs(i.incomeEffect), 0);

  return {
    netUncorrected,
    grossUncorrected,
    correctedTotal,
    uncorrectedCount: uncorrected.length,
    belowThresholdCount:
      clearlyTrivial > 0
        ? uncorrected.filter((i) => Math.abs(i.incomeEffect) < clearlyTrivial)
            .length
        : 0,
    exceedsOverall:
      overallMateriality > 0 &&
      Math.abs(netUncorrected) > overallMateriality,
    hasIndividuallyMaterial:
      overallMateriality > 0 &&
      uncorrected.some((i) => Math.abs(i.incomeEffect) > overallMateriality),
  };
}
