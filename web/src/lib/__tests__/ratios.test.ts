import { describe, expect, it } from "vitest";
import {
  calculateAccountChanges,
  calculateRatios,
  calculateValuationRatios,
  crossCheckAccounts,
} from "../ratios";
import type { NormalizedFinancials, StatementRow } from "../financials";

const row = (account: string, prior: number, current: number): StatementRow => ({
  account,
  prior,
  current,
});

/** 유동비율 200%, 부채비율 50%가 나오도록 구성한 기준 재무제표. */
const base: NormalizedFinancials = {
  bs: [
    row("유동자산합계", 400, 500),
    row("재고자산", 80, 100),
    row("유동부채합계", 200, 250),
    row("자산총계", 900, 1000),
    row("부채총계", 300, 400),
    row("자본총계", 600, 800),
    row("매출채권", 100, 120),
  ],
  is: [
    row("매출액", 1000, 1200),
    row("매출원가", 700, 800),
    row("영업이익", 150, 200),
    row("이자비용", 40, 50),
    row("당기순이익", 100, 160),
  ],
};

function ratio(groups: ReturnType<typeof calculateRatios>, label: string) {
  for (const g of groups) {
    const hit = g.ratios.find((r) => r.label === label);
    if (hit) return hit.value;
  }
  throw new Error(`비율을 찾지 못함: ${label}`);
}

describe("calculateRatios", () => {
  const groups = calculateRatios(base);

  it("4개 그룹을 모두 반환한다", () => {
    expect(groups.map((g) => g.category)).toEqual([
      "유동성",
      "수익성",
      "성장성",
      "안정성",
    ]);
  });

  it("유동비율 = 유동자산 ÷ 유동부채", () => {
    expect(ratio(groups, "유동비율")).toBe(200);
  });

  it("당좌비율은 재고자산을 뺀다", () => {
    expect(ratio(groups, "당좌비율")).toBe(160); // (500-100)/250
  });

  it("매출총이익률은 매출총이익 행이 없으면 매출액−매출원가로 산출한다", () => {
    // DART·엑셀 경로 모두 매출총이익을 항상 주지는 않는다.
    expect(ratio(groups, "매출총이익률")).toBeCloseTo((400 / 1200) * 100, 10);
  });

  it("부채비율 = 부채총계 ÷ 자본총계", () => {
    expect(ratio(groups, "부채비율")).toBe(50);
  });

  it("이자보상배율 = 영업이익 ÷ 이자비용", () => {
    expect(ratio(groups, "이자보상배율")).toBe(4);
  });

  it("성장률은 전기 절대값 기준으로 계산한다", () => {
    expect(ratio(groups, "매출액증가율")).toBeCloseTo(20, 10);
    expect(ratio(groups, "순이익증가율")).toBeCloseTo(60, 10);
  });

  it("전기가 적자면 부호에 휘둘리지 않도록 |전기|로 나눈다", () => {
    const turnaround = calculateRatios({
      ...base,
      is: [row("매출액", 1000, 1200), row("당기순이익", -100, 50)],
    });
    // (50 − (−100)) / |−100| = +150%
    expect(ratio(turnaround, "순이익증가율")).toBeCloseTo(150, 10);
  });

  it("분모가 0이거나 계정이 없으면 null (0으로 표시하면 오해를 부른다)", () => {
    const broken = calculateRatios({
      bs: [row("유동자산합계", 0, 100), row("유동부채합계", 0, 0)],
      is: [],
    });
    expect(ratio(broken, "유동비율")).toBeNull();
    expect(ratio(broken, "영업이익률")).toBeNull();
  });
});

describe("calculateValuationRatios", () => {
  const financials: NormalizedFinancials = {
    bs: [row("자본총계", 0, 5_000_000)],
    is: [row("당기순이익", 0, 1_000_000), row("기본주당이익", 0, 100)],
  };

  it("EPS로 발행주식수를 역산해 BPS를 추정한다", () => {
    const [eps, bps] = calculateValuationRatios(financials, null);
    expect(eps.value).toBe(100);
    // 추정 주식수 = 1,000,000 ÷ 100 = 10,000주 → BPS = 5,000,000 ÷ 10,000
    expect(bps.value).toBe(500);
  });

  it("주가가 있어야 PER·PBR이 계산된다", () => {
    const withoutPrice = calculateValuationRatios(financials, null);
    expect(withoutPrice[2].value).toBeNull();
    expect(withoutPrice[3].value).toBeNull();

    const withPrice = calculateValuationRatios(financials, 1000);
    expect(withPrice[2].value).toBe(10); // PER = 1000 ÷ 100
    expect(withPrice[3].value).toBe(2); // PBR = 1000 ÷ 500
  });

  it("EPS 공시가 없는 비상장 경로에서는 전부 null", () => {
    const unlisted = calculateValuationRatios(
      { bs: [row("자본총계", 0, 100)], is: [row("당기순이익", 0, 10)] },
      1000
    );
    expect(unlisted.every((r) => r.value === null)).toBe(true);
  });
});

describe("calculateAccountChanges", () => {
  it("임계치를 넘는 증감만 이상으로 표시한다", () => {
    const changes = calculateAccountChanges([
      row("매출채권", 100, 130), // +30% → 이상
      row("재고자산", 100, 110), // +10% → 정상
    ]);
    expect(changes[0].isAbnormal).toBe(true);
    expect(changes[0].changeRate).toBeCloseTo(30, 10);
    expect(changes[1].isAbnormal).toBe(false);
  });

  it("감소도 절대값 기준으로 잡는다", () => {
    const [c] = calculateAccountChanges([row("재고자산", 100, 60)]);
    expect(c.changeRate).toBeCloseTo(-40, 10);
    expect(c.isAbnormal).toBe(true);
  });

  it("전기 0 → 당기 발생은 증감률이 없어도 '신규'로 잡는다", () => {
    // 증감률이 정의되지 않아 예전 로직은 이걸 놓쳤다. 새로 생긴 잔액이야말로
    // ISA 520이 놓치면 안 되는 대상이다.
    const [c] = calculateAccountChanges([row("파생상품자산", 0, 5_000)]);
    expect(c.isNew).toBe(true);
    expect(c.changeRate).toBeNull();
    expect(c.isAbnormal).toBe(true);
  });

  it("전기·당기 모두 0이면 신규가 아니다", () => {
    const [c] = calculateAccountChanges([row("휴면계정", 0, 0)]);
    expect(c.isNew).toBe(false);
    expect(c.isAbnormal).toBe(false);
  });

  it("중요성 금액을 주면 금액이 사소한 변동은 걸러진다", () => {
    // 비율만 보면 +50%지만 금액으로는 10원이라 감사인이 볼 이유가 없다.
    const changes = calculateAccountChanges(
      [row("소액계정", 20, 30), row("재고자산", 1000, 1500)],
      20,
      100
    );
    expect(changes[0].isAbnormal).toBe(false);
    expect(changes[1].isAbnormal).toBe(true);
  });

  it("임계치는 조정할 수 있다", () => {
    const [c] = calculateAccountChanges([row("매출채권", 100, 110)], 5);
    expect(c.isAbnormal).toBe(true);
  });
});

describe("crossCheckAccounts", () => {
  it("매출채권이 매출보다 훨씬 빨리 늘면 허위매출 신호로 잡는다", () => {
    const flags = crossCheckAccounts({
      bs: [row("매출채권", 100, 200)], // +100%
      is: [row("매출액", 1000, 1100)], // +10%
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].label).toContain("매출채권");
  });

  it("재고자산 급증도 별도 신호로 잡는다", () => {
    const flags = crossCheckAccounts({
      bs: [row("재고자산", 100, 200)],
      is: [row("매출액", 1000, 1000)],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].label).toContain("재고자산");
  });

  it("매출과 나란히 늘면 신호가 아니다", () => {
    const flags = crossCheckAccounts({
      bs: [row("매출채권", 100, 120), row("재고자산", 100, 115)],
      is: [row("매출액", 1000, 1200)],
    });
    expect(flags).toEqual([]);
  });
});
