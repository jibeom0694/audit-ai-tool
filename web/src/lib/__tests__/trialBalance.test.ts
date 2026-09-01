import { describe, expect, it } from "vitest";
import { checkTrialBalance, type TrialBalanceRow } from "../trialBalance";

// 잔액은 차변 양수(+)·대변 음수(−)의 부호형이라, 전체 기말잔액 합계가 0이어야 한다.

const tb = (over: Partial<TrialBalanceRow>): TrialBalanceRow => ({
  code: "101",
  account: "현금및현금성자산",
  opening: 0,
  debit: 0,
  credit: 0,
  closing: 0,
  ...over,
});

/** 차대변이 맞고 roll-forward도 모두 성립하는 정상 시산표. */
const balanced: TrialBalanceRow[] = [
  tb({ code: "101", account: "현금", opening: 10_000_000, debit: 5_000_000, credit: 3_000_000, closing: 12_000_000 }),
  tb({ code: "108", account: "매출채권", opening: 8_000_000, debit: 2_000_000, credit: 1_000_000, closing: 9_000_000 }),
  tb({ code: "251", account: "매입채무", opening: -6_000_000, debit: 1_000_000, credit: 2_000_000, closing: -7_000_000 }),
  tb({ code: "331", account: "자본금", opening: -12_000_000, debit: 0, credit: 2_000_000, closing: -14_000_000 }),
];

describe("checkTrialBalance — 균형 검증", () => {
  it("정상 시산표는 모든 검증을 통과한다", () => {
    const result = checkTrialBalance(balanced);
    expect(result.rowCount).toBe(4);
    expect(result.closingBalanceSum).toBe(0);
    expect(result.isBalanced).toBe(true);
    expect(result.periodActivityBalanced).toBe(true);
    expect(result.rollForwardMismatches).toEqual([]);
  });

  it("기말잔액 합계가 0이 아니면 차대변 불균형으로 잡는다", () => {
    const broken = [...balanced, tb({ code: "999", account: "가공계정", closing: 2_400_000 })];
    const result = checkTrialBalance(broken);
    expect(result.closingBalanceSum).toBe(2_400_000);
    expect(result.isBalanced).toBe(false);
  });

  it("당기차변 합계와 당기대변 합계가 다르면 잡는다", () => {
    const result = checkTrialBalance([
      tb({ debit: 5_000_000, credit: 2_500_000, closing: 2_500_000 }),
    ]);
    expect(result.periodDebitTotal).toBe(5_000_000);
    expect(result.periodCreditTotal).toBe(2_500_000);
    expect(result.periodActivityBalanced).toBe(false);
  });
});

describe("checkTrialBalance — 계정별 roll-forward", () => {
  it("기초 + 당기차변 − 당기대변 ≠ 기말이면 그 계정만 집어낸다", () => {
    const rows = [
      ...balanced,
      tb({ code: "146", account: "재고자산", opening: 5_000_000, debit: 1_000_000, credit: 500_000, closing: 4_000_000 }),
    ];
    const result = checkTrialBalance(rows);
    expect(result.rollForwardMismatches).toHaveLength(1);
    expect(result.rollForwardMismatches[0]).toMatchObject({
      account: "재고자산",
      expected: 5_500_000,
      closing: 4_000_000,
      diff: -1_500_000,
    });
  });

  it("불일치가 여러 건이면 모두 보고한다", () => {
    const result = checkTrialBalance([
      tb({ code: "A", account: "A", opening: 100, debit: 0, credit: 0, closing: 200 }),
      tb({ code: "B", account: "B", opening: 100, debit: 0, credit: 0, closing: 50 }),
    ]);
    expect(result.rollForwardMismatches.map((m) => m.account)).toEqual(["A", "B"]);
  });
});

describe("checkTrialBalance — 반올림 허용오차", () => {
  it("±1원까지는 균형으로 본다 (원 단위 반올림)", () => {
    const result = checkTrialBalance([
      tb({ opening: 0, debit: 100, credit: 0, closing: 101 }),
    ]);
    expect(result.rollForwardMismatches).toEqual([]);
    expect(result.isBalanced).toBe(false); // 잔액 합계 101원은 균형이 아니다
  });

  it("1원을 넘으면 불일치로 본다", () => {
    const result = checkTrialBalance([
      tb({ opening: 0, debit: 100, credit: 0, closing: 102 }),
    ]);
    expect(result.rollForwardMismatches).toHaveLength(1);
    expect(result.rollForwardMismatches[0].diff).toBe(2);
  });

  it("합계 ±1원 이내면 차대변 균형으로 본다", () => {
    expect(checkTrialBalance([tb({ closing: 1 })]).isBalanced).toBe(true);
    expect(checkTrialBalance([tb({ closing: -1 })]).isBalanced).toBe(true);
  });
});

describe("checkTrialBalance — 빈 입력", () => {
  it("행이 없으면 합계 0으로 균형 처리한다", () => {
    const result = checkTrialBalance([]);
    expect(result.rowCount).toBe(0);
    expect(result.isBalanced).toBe(true);
    expect(result.rollForwardMismatches).toEqual([]);
  });
});
