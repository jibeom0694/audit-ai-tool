import { describe, expect, it } from "vitest";
import { reconcileJournalToTrialBalance } from "../reconciliation";
import type { JournalRow } from "../excelParse";
import type { TrialBalanceRow } from "../trialBalance";

function je(
  account: string,
  debit: number,
  credit: number,
  entryNo = "1"
): JournalRow {
  return {
    entryNo,
    date: "2025-06-01",
    time: "10:00",
    account,
    counterparty: "",
    debit,
    credit,
    preparer: "",
    approver: "",
    memo: "",
  };
}

function tb(
  account: string,
  debit: number,
  credit: number,
  code = "1000"
): TrialBalanceRow {
  return { code, account, opening: 0, debit, credit, closing: debit - credit };
}

describe("reconcileJournalToTrialBalance — 정상 대사", () => {
  const journal = [
    je("매출채권", 1_000_000, 0, "1"),
    je("매출", 0, 1_000_000, "1"),
    je("현금", 300_000, 0, "2"),
    je("매출채권", 0, 300_000, "2"),
  ];
  const trial = [
    tb("매출채권", 1_000_000, 300_000),
    tb("매출", 0, 1_000_000),
    tb("현금", 300_000, 0),
  ];

  it("계정별 발생액이 일치하면 차이가 없다", () => {
    const r = reconcileJournalToTrialBalance(journal, trial);
    expect(r.isClean).toBe(true);
    expect(r.mismatchCount).toBe(0);
    expect(r.unmatchedAccountCount).toBe(0);
  });

  it("같은 계정의 여러 전표를 합산해서 비교한다", () => {
    const r = reconcileJournalToTrialBalance(journal, trial);
    const ar = r.matched.find((m) => m.account === "매출채권")!;
    expect(ar.journalDebit).toBe(1_000_000);
    expect(ar.journalCredit).toBe(300_000);
    expect(ar.entryCount).toBe(2);
    expect(ar.isMatched).toBe(true);
  });

  it("합계 대사와 전표 자체 차대변 균형도 본다", () => {
    const r = reconcileJournalToTrialBalance(journal, trial);
    expect(r.totals.journalDebit).toBe(1_300_000);
    expect(r.totals.tbDebit).toBe(1_300_000);
    expect(r.totals.isMatched).toBe(true);
    expect(r.journalSelfBalanced).toBe(true);
  });
});

describe("reconcileJournalToTrialBalance — 차이 검출", () => {
  it("시산표가 전표보다 크면 그 계정을 짚어낸다", () => {
    // 시산표를 손으로 부풀린 상황. 시산표 자체 검증(차대변 균형)은 통과하지만
    // 원장과는 맞지 않는다 — 이게 대사가 필요한 이유다.
    const journal = [je("매출채권", 1_000_000, 0)];
    const trial = [tb("매출채권", 1_500_000, 0)];
    const r = reconcileJournalToTrialBalance(journal, trial);

    expect(r.isClean).toBe(false);
    expect(r.mismatchCount).toBe(1);
    const ar = r.matched[0];
    expect(ar.debitDiff).toBe(-500_000); // 전표 − 시산표
    expect(ar.isMatched).toBe(false);
  });

  it("차이가 큰 계정을 위로 올린다", () => {
    const journal = [je("현금", 100, 0), je("매출채권", 900_000, 0)];
    const trial = [tb("현금", 200, 0), tb("매출채권", 1_000_000, 0)];
    const r = reconcileJournalToTrialBalance(journal, trial);
    expect(r.matched[0].account).toBe("매출채권"); // 차이 10만 > 차이 100
  });

  it("1원 이하 반올림 차이는 일치로 본다", () => {
    const r = reconcileJournalToTrialBalance(
      [je("매출채권", 1_000_000, 0)],
      [tb("매출채권", 1_000_001, 0)]
    );
    expect(r.mismatchCount).toBe(0);
    expect(r.isClean).toBe(true);
  });

  it("전표 자체 차대변이 안 맞으면 표시한다", () => {
    const r = reconcileJournalToTrialBalance(
      [je("매출채권", 1_000_000, 0)], // 대변이 없다
      [tb("매출채권", 1_000_000, 0)]
    );
    expect(r.journalSelfBalanced).toBe(false);
  });
});

describe("reconcileJournalToTrialBalance — 대사 불가 계정", () => {
  it("계정과목 표기가 다르면 조용히 넘기지 않고 양쪽에 남긴다", () => {
    // 전표는 "외상매출금", 시산표는 "매출채권". 이걸 0으로 뭉개면 대사가
    // 통과한 것처럼 보인다 — 감사 도구에서 가장 위험한 실패다.
    const r = reconcileJournalToTrialBalance(
      [je("외상매출금", 1_000_000, 0)],
      [tb("매출채권", 1_000_000, 0)]
    );

    expect(r.isClean).toBe(false);
    expect(r.unmatchedAccountCount).toBe(2);
    expect(r.journalOnly[0].account).toBe("외상매출금");
    expect(r.trialBalanceOnly[0].account).toBe("매출채권");
    expect(r.matched).toHaveLength(0);
    // 합계끼리는 우연히 맞을 수 있다. 그래도 isClean은 false여야 한다.
    expect(r.totals.isMatched).toBe(true);
  });

  it("공백 차이는 같은 계정으로 본다", () => {
    const r = reconcileJournalToTrialBalance(
      [je("매출 채권", 1_000_000, 0)],
      [tb("매출채권", 1_000_000, 0)]
    );
    expect(r.matched).toHaveLength(1);
    expect(r.isClean).toBe(true);
  });

  it("기중 발생액이 0인 시산표 계정은 전표가 없어도 정상이다", () => {
    // 기초잔액만 있고 기중 거래가 없는 계정은 전표가 없는 게 당연하다.
    const r = reconcileJournalToTrialBalance(
      [je("현금", 100_000, 0)],
      [tb("현금", 100_000, 0), tb("토지", 0, 0)]
    );
    expect(r.trialBalanceOnly).toHaveLength(0);
    expect(r.isClean).toBe(true);
  });

  it("시산표에 발생액이 있는데 전표가 없으면 원장 누락으로 짚는다", () => {
    const r = reconcileJournalToTrialBalance(
      [je("현금", 100_000, 0)],
      [tb("현금", 100_000, 0), tb("잡손실", 50_000, 0)]
    );
    expect(r.trialBalanceOnly).toHaveLength(1);
    expect(r.trialBalanceOnly[0].account).toBe("잡손실");
    expect(r.isClean).toBe(false);
  });
});

describe("reconcileJournalToTrialBalance — 경계", () => {
  it("빈 입력도 터지지 않는다", () => {
    const r = reconcileJournalToTrialBalance([], []);
    expect(r.matched).toHaveLength(0);
    expect(r.isClean).toBe(true);
    expect(r.totals.journalDebit).toBe(0);
  });

  it("계정과목이 비어 있는 행은 건너뛴다", () => {
    const r = reconcileJournalToTrialBalance(
      [je("", 999, 0), je("현금", 100, 0)],
      [tb("현금", 100, 0)]
    );
    expect(r.matched).toHaveLength(1);
    expect(r.journalOnly).toHaveLength(0);
  });

  it("같은 계정과목이 코드만 다르게 여러 행이면 합산한다", () => {
    const r = reconcileJournalToTrialBalance(
      [je("매출", 0, 300_000)],
      [tb("매출", 0, 100_000, "4100"), tb("매출", 0, 200_000, "4200")]
    );
    expect(r.matched[0].tbCredit).toBe(300_000);
    expect(r.isClean).toBe(true);
  });
});
