import { describe, expect, it } from "vitest";
import {
  calculateAltmanZScore,
  calculateBeneishMScore,
  detectRoundTripTransactions,
  runBenfordTest,
  runRsfTest,
} from "../anomalyDetection";
import type { NormalizedFinancials, StatementRow } from "../financials";
import type { JournalRow } from "../excelParse";

const row = (account: string, prior: number, current: number): StatementRow => ({
  account,
  prior,
  current,
});

const je = (over: Partial<JournalRow>): JournalRow => ({
  entryNo: "JE-0001",
  date: "2025-06-02",
  time: "10:00",
  account: "매출",
  counterparty: "",
  debit: 0,
  credit: 0,
  preparer: "김대리",
  approver: "최부장",
  memo: "테스트",
  ...over,
});

/* ── Benford ───────────────────────────────────────────────── */

/** 첫자리 분포가 벤포드 기대값과 (반올림 오차 범위에서) 정확히 일치하는 표본. */
function benfordConformingAmounts(total = 1000): number[] {
  const amounts: number[] = [];
  for (let d = 1; d <= 9; d++) {
    const count = Math.round(Math.log10(1 + 1 / d) * total);
    for (let i = 0; i < count; i++) {
      amounts.push(d * 1000 + (i % 999));
    }
  }
  return amounts;
}

/** 첫자리 1의 비중 1%p를 9로 옮긴 표본. 편차 '비율'이 표본크기와 무관하게 같다. */
function benfordSkewedAmounts(total = 1000): number[] {
  const shift = Math.round(total * 0.01);
  const amounts: number[] = [];
  for (let d = 1; d <= 9; d++) {
    let count = Math.round(Math.log10(1 + 1 / d) * total);
    if (d === 1) count -= shift;
    if (d === 9) count += shift;
    for (let i = 0; i < count; i++) {
      amounts.push(d * 1000 + (i % 999));
    }
  }
  return amounts;
}

describe("runBenfordTest", () => {
  it("표본이 30건 미만이면 판정하지 않는다 (통계적으로 무의미)", () => {
    expect(runBenfordTest([1, 2, 3])).toBeNull();
    expect(runBenfordTest(new Array(29).fill(1234))).toBeNull();
  });

  it("1 미만 금액은 표본에서 제외한다", () => {
    // 0원·소수점 금액은 첫자리가 없다. 30건을 채우지 못해 null이 되어야 한다.
    expect(runBenfordTest(new Array(40).fill(0.4))).toBeNull();
  });

  it("벤포드를 따르는 데이터는 '근접 적합'으로 판정한다", () => {
    const result = runBenfordTest(benfordConformingAmounts())!;
    expect(result.conformity).toBe("close");
    expect(result.isSuspicious).toBe(false);
    expect(result.digits).toHaveLength(9);
    expect(result.digits[0].expectedPercent).toBeCloseTo(30.1, 1);
  });

  it("한 자리에 쏠린 데이터는 부적합으로 잡는다", () => {
    const result = runBenfordTest(new Array(500).fill(0).map((_, i) => 9000 + i))!;
    expect(result.conformity).toBe("nonconform");
    expect(result.isSuspicious).toBe(true);
  });

  it("판정은 카이제곱이 아니라 표본크기에 무관한 MAD로 내린다", () => {
    // 편차 비율이 똑같은 분포를 10배로 늘리면, 카이제곱은 표본크기에 비례해
    // 커져서 "유의한 이상"이라고 말하기 시작한다(큰 원장에서의 과탐). MAD는
    // 비율 기반이라 그대로다 — 그래서 판정을 MAD로 내린다.
    const small = runBenfordTest(benfordSkewedAmounts(1000))!;
    const large = runBenfordTest(benfordSkewedAmounts(10000))!;

    // 반올림으로 표본별 미세 차이는 남지만 자릿수가 그대로다(≈0.0023).
    expect(small.mad).toBeCloseTo(large.mad, 3);
    expect(small.conformity).toBe(large.conformity);
    expect(large.chiSquare).toBeGreaterThan(small.chiSquare * 5);
  });

  it("표본이 300건 미만이면 첫 두 자리 검정은 건너뛴다", () => {
    const result = runBenfordTest(new Array(100).fill(0).map((_, i) => 1000 + i))!;
    expect(result.firstTwoMad).toBeNull();
    expect(result.firstTwoConformity).toBeNull();
  });

  it("표본이 충분하면 첫 두 자리(10~99) 검정까지 수행한다", () => {
    const result = runBenfordTest(benfordConformingAmounts(2000))!;
    expect(result.firstTwoDigits).toHaveLength(90);
    expect(result.firstTwoMad).not.toBeNull();
  });

  it("부호와 소수점을 무시하고 절대값의 첫자리를 본다", () => {
    const result = runBenfordTest(new Array(50).fill(-2345.67))!;
    expect(result.digits[1].actualPercent).toBe(100); // digit 2
  });
});

/* ── Beneish M-Score ───────────────────────────────────────── */

/** 전기·당기가 동일해 8개 지수가 모두 1(TATA는 0)이 되는 재무제표. */
const flatFinancials: NormalizedFinancials = {
  bs: [
    row("매출채권", 100, 100),
    row("유동자산합계", 500, 500),
    row("유형자산", 300, 300),
    row("자산총계", 1000, 1000),
    row("부채총계", 400, 400),
  ],
  is: [
    row("매출액", 1000, 1000),
    row("매출원가", 600, 600),
    row("판매비와관리비", 200, 200),
    row("당기순이익", 100, 100),
  ],
  cf: [row("감가상각비", 50, 50), row("영업활동현금흐름", 100, 100)],
};

describe("calculateBeneishMScore", () => {
  it("변동이 없으면 지수가 모두 1이고 M-Score는 −2.48", () => {
    const result = calculateBeneishMScore(flatFinancials)!;
    for (const c of result.components) {
      if (c.key === "TATA") expect(c.value).toBeCloseTo(0, 10);
      else expect(c.value).toBeCloseTo(1, 10);
    }
    expect(result.score).toBeCloseTo(-2.48, 10);
  });

  it("임계값 −1.78을 넘으면 위험군으로 분류한다", () => {
    expect(calculateBeneishMScore(flatFinancials)!.isSuspicious).toBe(false);

    // 매출채권·매출이 급증하고 영업현금흐름이 순이익을 크게 밑도는 전형적 신호
    const aggressive = calculateBeneishMScore({
      ...flatFinancials,
      bs: [
        row("매출채권", 100, 400),
        row("유동자산합계", 500, 500),
        row("유형자산", 300, 300),
        row("자산총계", 1000, 1000),
        row("부채총계", 400, 400),
      ],
      cf: [row("감가상각비", 50, 50), row("영업활동현금흐름", 100, -200)],
    })!;
    expect(aggressive.score).toBeGreaterThan(-1.78);
    expect(aggressive.isSuspicious).toBe(true);
  });

  it("현금흐름표가 없으면 TATA를 못 구해 계산하지 않는다", () => {
    // Upstage 인식 경로는 현금흐름표를 추출하지 않는다.
    const withoutCf: NormalizedFinancials = {
      bs: flatFinancials.bs,
      is: flatFinancials.is,
    };
    expect(calculateBeneishMScore(withoutCf)).toBeNull();
  });

  it("필수 계정이 하나라도 없으면 null", () => {
    expect(
      calculateBeneishMScore({ ...flatFinancials, bs: [row("자산총계", 1, 1)] })
    ).toBeNull();
  });

  it("전기 분모가 0이면 null (0으로 나눈 값을 점수로 내보내지 않는다)", () => {
    expect(
      calculateBeneishMScore({
        ...flatFinancials,
        is: [
          row("매출액", 0, 1000),
          row("매출원가", 600, 600),
          row("판매비와관리비", 200, 200),
          row("당기순이익", 100, 100),
        ],
      })
    ).toBeNull();
  });
});

/* ── Altman Z'-Score ───────────────────────────────────────── */

function altman(over: Record<string, [number, number]>): NormalizedFinancials {
  const v = (k: string) => over[k] ?? [0, 0];
  return {
    bs: [
      row("유동자산합계", ...v("유동자산")),
      row("유동부채합계", ...v("유동부채")),
      row("자산총계", ...v("자산총계")),
      row("이익잉여금", ...v("이익잉여금")),
      row("자본총계", ...v("자본총계")),
      row("부채총계", ...v("부채총계")),
    ],
    is: [row("영업이익", ...v("영업이익")), row("매출액", ...v("매출액"))],
  };
}

describe("calculateAltmanZScore", () => {
  it("건전한 재무구조는 safe 구간", () => {
    const result = calculateAltmanZScore(
      altman({
        유동자산: [0, 800],
        유동부채: [0, 100],
        자산총계: [0, 1000],
        이익잉여금: [0, 600],
        영업이익: [0, 200],
        자본총계: [0, 800],
        부채총계: [0, 200],
        매출액: [0, 1500],
      })
    )!;
    expect(result.score).toBeGreaterThan(2.9);
    expect(result.zone).toBe("safe");
  });

  it("중간 구간은 grey", () => {
    const result = calculateAltmanZScore(
      altman({
        유동자산: [0, 500],
        유동부채: [0, 200],
        자산총계: [0, 1000],
        이익잉여금: [0, 300],
        영업이익: [0, 100],
        자본총계: [0, 600],
        부채총계: [0, 400],
        매출액: [0, 1200],
      })
    )!;
    expect(result.score).toBeCloseTo(2.6075, 4);
    expect(result.zone).toBe("grey");
  });

  it("결손·자본잠식 기업은 distress 구간", () => {
    const result = calculateAltmanZScore(
      altman({
        유동자산: [0, 100],
        유동부채: [0, 500],
        자산총계: [0, 1000],
        이익잉여금: [0, -200],
        영업이익: [0, -50],
        자본총계: [0, 50],
        부채총계: [0, 950],
        매출액: [0, 300],
      })
    )!;
    expect(result.score).toBeLessThan(1.23);
    expect(result.zone).toBe("distress");
  });

  it("자기자본은 시가총액이 아니라 장부가액을 쓴다 (비상장 대응 Z'-Score)", () => {
    const result = calculateAltmanZScore(
      altman({
        유동자산: [0, 500],
        유동부채: [0, 200],
        자산총계: [0, 1000],
        이익잉여금: [0, 300],
        영업이익: [0, 100],
        자본총계: [0, 600],
        부채총계: [0, 400],
        매출액: [0, 1200],
      })
    )!;
    const x4 = result.components.find((c) => c.key === "X4")!;
    expect(x4.label).toContain("장부가");
    expect(x4.value).toBe(1.5); // 자본총계 600 ÷ 부채총계 400
  });

  it("계정이 부족하거나 분모가 0이면 null", () => {
    expect(calculateAltmanZScore({ bs: [], is: [] })).toBeNull();
    expect(
      calculateAltmanZScore(
        altman({
          유동자산: [0, 100],
          유동부채: [0, 50],
          자산총계: [0, 1000],
          이익잉여금: [0, 10],
          영업이익: [0, 10],
          자본총계: [0, 10],
          부채총계: [0, 0], // 부채 0 → X4 정의 불가
          매출액: [0, 100],
        })
      )
    ).toBeNull();
  });
});

/* ── RSF ───────────────────────────────────────────────────── */

describe("runRsfTest", () => {
  it("최대금액이 차순위의 3배 이상이면 이상치 후보로 잡는다", () => {
    const flags = runRsfTest([
      je({ account: "지급수수료", debit: 100_000_000 }),
      je({ account: "지급수수료", debit: 5_000_000 }),
      je({ account: "지급수수료", debit: 3_000_000 }),
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0].account).toBe("지급수수료");
    expect(flags[0].largest).toBe(100_000_000);
    expect(flags[0].secondLargest).toBe(5_000_000);
    expect(flags[0].rsf).toBe(20);
  });

  it("고른 금액대는 잡지 않는다", () => {
    expect(
      runRsfTest([
        je({ account: "소모품비", debit: 100 }),
        je({ account: "소모품비", debit: 90 }),
      ])
    ).toEqual([]);
  });

  it("거래가 1건뿐인 계정은 비교 대상이 없어 건너뛴다", () => {
    expect(runRsfTest([je({ account: "잡손실", debit: 999_999_999 })])).toEqual([]);
  });

  it("RSF가 큰 순으로 정렬한다", () => {
    const flags = runRsfTest([
      je({ account: "A", debit: 400 }),
      je({ account: "A", debit: 100 }),
      je({ account: "B", debit: 1000 }),
      je({ account: "B", debit: 100 }),
    ]);
    expect(flags.map((f) => f.account)).toEqual(["B", "A"]);
  });
});

/* ── 라운드트립 ────────────────────────────────────────────── */

describe("detectRoundTripTransactions", () => {
  it("같은 거래처에 짧은 기간·비슷한 금액으로 판 뒤 사들이면 잡는다", () => {
    const flags = detectRoundTripTransactions([
      je({
        entryNo: "JE-1",
        date: "2025-11-05",
        account: "제품매출",
        counterparty: "(주)거래상대",
        credit: 100_000_000,
      }),
      je({
        entryNo: "JE-2",
        date: "2025-11-20",
        account: "원재료매입",
        counterparty: "(주)거래상대",
        debit: 98_000_000,
      }),
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0].counterparty).toBe("(주)거래상대");
    expect(flags[0].daysApart).toBe(15);
  });

  it("정상적인 매출채권 회수는 오탐하지 않는다", () => {
    // 예전 로직은 차/대변 부호만 봐서 이런 정상 결제를 전부 순환거래로 잡았다.
    const flags = detectRoundTripTransactions([
      je({
        entryNo: "JE-1",
        date: "2025-11-05",
        account: "매출채권",
        counterparty: "(주)고객사",
        credit: 50_000_000,
      }),
      je({
        entryNo: "JE-1",
        date: "2025-11-05",
        account: "현금및현금성자산",
        counterparty: "(주)고객사",
        debit: 50_000_000,
      }),
    ]);
    expect(flags).toEqual([]);
  });

  it("매입채무 지급도 오탐하지 않는다", () => {
    const flags = detectRoundTripTransactions([
      je({
        entryNo: "JE-2",
        date: "2025-11-05",
        account: "매입채무",
        counterparty: "(주)공급사",
        debit: 30_000_000,
      }),
      je({
        entryNo: "JE-2",
        date: "2025-11-05",
        account: "현금및현금성자산",
        counterparty: "(주)공급사",
        credit: 30_000_000,
      }),
    ]);
    expect(flags).toEqual([]);
  });

  it("30일을 넘어서면 잡지 않는다", () => {
    const flags = detectRoundTripTransactions([
      je({ entryNo: "JE-1", date: "2025-01-05", account: "제품매출", counterparty: "A", credit: 100 }),
      je({ entryNo: "JE-2", date: "2025-03-05", account: "원재료매입", counterparty: "A", debit: 100 }),
    ]);
    expect(flags).toEqual([]);
  });

  it("금액 차이가 5%를 넘으면 잡지 않는다", () => {
    const flags = detectRoundTripTransactions([
      je({ entryNo: "JE-1", date: "2025-01-05", account: "제품매출", counterparty: "A", credit: 100 }),
      je({ entryNo: "JE-2", date: "2025-01-10", account: "원재료매입", counterparty: "A", debit: 80 }),
    ]);
    expect(flags).toEqual([]);
  });

  it("같은 전표 안의 차·대변 상계는 제외한다", () => {
    const flags = detectRoundTripTransactions([
      je({ entryNo: "JE-9", date: "2025-01-05", account: "제품매출", counterparty: "A", credit: 100 }),
      je({ entryNo: "JE-9", date: "2025-01-05", account: "원재료매입", counterparty: "A", debit: 100 }),
    ]);
    expect(flags).toEqual([]);
  });

  it("매출 1건은 매입 1건에만 매칭한다 (중복 보고 방지)", () => {
    const flags = detectRoundTripTransactions([
      je({ entryNo: "S1", date: "2025-01-05", account: "제품매출", counterparty: "A", credit: 100 }),
      je({ entryNo: "P1", date: "2025-01-06", account: "원재료매입", counterparty: "A", debit: 100 }),
      je({ entryNo: "P2", date: "2025-01-07", account: "원재료매입", counterparty: "A", debit: 100 }),
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0].purchaseEntryNo).toBe("P1"); // 가장 가까운 건
  });

  it("거래처가 비어 있으면 판단하지 않는다", () => {
    const flags = detectRoundTripTransactions([
      je({ entryNo: "S1", date: "2025-01-05", account: "제품매출", counterparty: "", credit: 100 }),
      je({ entryNo: "P1", date: "2025-01-06", account: "원재료매입", counterparty: "", debit: 100 }),
    ]);
    expect(flags).toEqual([]);
  });

  it("매출만 있고 매입이 없으면 라운드트립이 아니다", () => {
    const flags = detectRoundTripTransactions([
      je({ entryNo: "S1", date: "2025-01-05", account: "제품매출", counterparty: "A", credit: 100 }),
    ]);
    expect(flags).toEqual([]);
  });
});
