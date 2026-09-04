// 원장(전표) → 시산표 대사.
//
// 시산표 자체가 무결한지는 trialBalance.ts가 본다(차대변 균형·계정별
// roll-forward). 그건 "시산표 안에서 앞뒤가 맞는가"일 뿐, 그 시산표가 실제
// 원장에서 나온 것인지는 말해주지 않는다. 시산표는 얼마든지 손으로 고칠 수
// 있고, 고쳐도 자체 검증은 그대로 통과한다.
//
// 그래서 전표를 계정별로 집계해 시산표의 당기 발생액과 맞춰본다. 이 대사를
// 통과해야 이후의 표본추출(MUS)·이상탐지가 신뢰할 수 있는 기초 위에서 돈다.
//
// 비교 대상은 '당기 발생액'(차변·대변)이다. 전표는 기중 거래만 담고 있어
// 기초잔액을 알지 못하므로, 기말잔액과 직접 비교할 수는 없다.

import type { JournalRow } from "./excelParse";
import type { TrialBalanceRow } from "./trialBalance";

// 원 단위 반올림 오차는 차이로 보지 않는다(trialBalance.ts와 같은 규약).
const TOLERANCE = 1;

/** 계정과목 표기 흔들림(공백·괄호 앞뒤 여백)을 흡수해 대사 키로 쓴다. */
function normalizeAccount(name: string): string {
  return String(name ?? "").replace(/\s+/g, "");
}

export type AccountReconciliation = {
  account: string;
  journalDebit: number;
  journalCredit: number;
  tbDebit: number;
  tbCredit: number;
  debitDiff: number;
  creditDiff: number;
  isMatched: boolean;
  /** 전표 건수. 차이가 났을 때 어디를 들춰볼지 가늠하는 데 쓴다. */
  entryCount: number;
};

export type ReconciliationResult = {
  /** 양쪽에 다 있는 계정의 대사 결과. 차이가 큰 순으로 정렬한다. */
  matched: AccountReconciliation[];
  /** 전표에는 있는데 시산표에 없는 계정 — 시산표 누락 의심. */
  journalOnly: { account: string; debit: number; credit: number; entryCount: number }[];
  /** 시산표에 당기 발생액이 있는데 전표가 없는 계정 — 원장 누락 의심. */
  trialBalanceOnly: { account: string; debit: number; credit: number }[];
  /** 계정 단위가 아니라 전체 합계끼리의 대사. */
  totals: {
    journalDebit: number;
    journalCredit: number;
    tbDebit: number;
    tbCredit: number;
    debitDiff: number;
    creditDiff: number;
    isMatched: boolean;
  };
  /** 전표 자체의 차대변이 맞는지(대사 이전에 원장이 성립하는지). */
  journalSelfBalanced: boolean;
  mismatchCount: number;
  /** 대사 자체가 불가능했던 계정 수(한쪽에만 있는 계정). */
  unmatchedAccountCount: number;
  isClean: boolean;
};

type Bucket = { debit: number; credit: number; entryCount: number; label: string };

function sumJournalByAccount(rows: JournalRow[]): Map<string, Bucket> {
  const map = new Map<string, Bucket>();
  for (const row of rows ?? []) {
    const key = normalizeAccount(row.account);
    if (!key) continue;
    const found = map.get(key) ?? {
      debit: 0,
      credit: 0,
      entryCount: 0,
      // 표시는 원본 표기를 그대로 쓴다(대사 키만 정규화한다).
      label: row.account,
    };
    found.debit += Number(row.debit) || 0;
    found.credit += Number(row.credit) || 0;
    found.entryCount += 1;
    map.set(key, found);
  }
  return map;
}

function sumTrialBalanceByAccount(rows: TrialBalanceRow[]): Map<string, Bucket> {
  const map = new Map<string, Bucket>();
  for (const row of rows ?? []) {
    const key = normalizeAccount(row.account);
    if (!key) continue;
    // 같은 계정과목이 코드만 다르게 여러 행으로 올 수 있어 합산한다.
    const found = map.get(key) ?? {
      debit: 0,
      credit: 0,
      entryCount: 0,
      label: row.account,
    };
    found.debit += Number(row.debit) || 0;
    found.credit += Number(row.credit) || 0;
    map.set(key, found);
  }
  return map;
}

/**
 * 전표를 계정별로 집계해 시산표의 당기 발생액(차변·대변)과 대사한다.
 *
 * 계정과목 표기가 전표와 시산표에서 다르면(예: 전표는 "외상매출금", 시산표는
 * "매출채권") 매칭이 안 된다. 이때 **조용히 0으로 처리하지 않고** journalOnly /
 * trialBalanceOnly로 따로 내보낸다. 차이를 0으로 뭉개면 대사가 통과한 것처럼
 * 보이는데, 그게 감사 도구에서 가장 위험한 실패다.
 */
export function reconcileJournalToTrialBalance(
  journalRows: JournalRow[],
  trialBalanceRows: TrialBalanceRow[]
): ReconciliationResult {
  const journal = sumJournalByAccount(journalRows);
  const tb = sumTrialBalanceByAccount(trialBalanceRows);

  const matched: AccountReconciliation[] = [];
  const journalOnly: ReconciliationResult["journalOnly"] = [];

  for (const [key, j] of journal) {
    const t = tb.get(key);
    if (!t) {
      journalOnly.push({
        account: j.label,
        debit: j.debit,
        credit: j.credit,
        entryCount: j.entryCount,
      });
      continue;
    }
    const debitDiff = j.debit - t.debit;
    const creditDiff = j.credit - t.credit;
    matched.push({
      account: j.label,
      journalDebit: j.debit,
      journalCredit: j.credit,
      tbDebit: t.debit,
      tbCredit: t.credit,
      debitDiff,
      creditDiff,
      isMatched:
        Math.abs(debitDiff) <= TOLERANCE && Math.abs(creditDiff) <= TOLERANCE,
      entryCount: j.entryCount,
    });
  }

  const trialBalanceOnly: ReconciliationResult["trialBalanceOnly"] = [];
  for (const [key, t] of tb) {
    if (journal.has(key)) continue;
    // 기중 거래가 없는 계정(발생액 0)은 전표가 없는 게 정상이므로 짚지 않는다.
    if (Math.abs(t.debit) <= TOLERANCE && Math.abs(t.credit) <= TOLERANCE) continue;
    trialBalanceOnly.push({ account: t.label, debit: t.debit, credit: t.credit });
  }

  // 차이가 큰 계정을 위로 올린다(감사인이 먼저 봐야 할 순서).
  matched.sort(
    (a, b) =>
      Math.max(Math.abs(b.debitDiff), Math.abs(b.creditDiff)) -
      Math.max(Math.abs(a.debitDiff), Math.abs(a.creditDiff))
  );

  const sum = (m: Map<string, Bucket>, k: "debit" | "credit") =>
    [...m.values()].reduce((acc, v) => acc + v[k], 0);

  const journalDebit = sum(journal, "debit");
  const journalCredit = sum(journal, "credit");
  const tbDebit = sum(tb, "debit");
  const tbCredit = sum(tb, "credit");
  const debitDiff = journalDebit - tbDebit;
  const creditDiff = journalCredit - tbCredit;

  const mismatchCount = matched.filter((m) => !m.isMatched).length;
  const unmatchedAccountCount = journalOnly.length + trialBalanceOnly.length;

  return {
    matched,
    journalOnly,
    trialBalanceOnly,
    totals: {
      journalDebit,
      journalCredit,
      tbDebit,
      tbCredit,
      debitDiff,
      creditDiff,
      isMatched:
        Math.abs(debitDiff) <= TOLERANCE && Math.abs(creditDiff) <= TOLERANCE,
    },
    journalSelfBalanced: Math.abs(journalDebit - journalCredit) <= TOLERANCE,
    mismatchCount,
    unmatchedAccountCount,
    // 계정 단위·합계·표기 매칭이 전부 통과해야 깨끗한 것으로 본다.
    isClean:
      mismatchCount === 0 &&
      unmatchedAccountCount === 0 &&
      Math.abs(debitDiff) <= TOLERANCE &&
      Math.abs(creditDiff) <= TOLERANCE,
  };
}
