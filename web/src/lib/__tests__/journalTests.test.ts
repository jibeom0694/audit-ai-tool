import { describe, expect, it } from "vitest";
import { runJournalEntryTests } from "../journalTests";
import type { JournalRow } from "../excelParse";

// ISA 240 전표 테스트. 각 테스트는 "예외항목"을 뽑아주는 것이지 부정을 확정하지
// 않는다 — 그래서 검증의 초점은 "잡아야 할 걸 잡는가"와 "정상 전표를 잡지 않는가"다.

const je = (over: Partial<JournalRow>): JournalRow => ({
  entryNo: "JE-0001",
  date: "2025-06-02", // 월요일
  time: "10:00",
  account: "지급수수료",
  counterparty: "거래처",
  debit: 1_234_567,
  credit: 0,
  preparer: "김대리",
  approver: "최부장",
  memo: "정상 거래",
  ...over,
});

function testByKey(
  summary: ReturnType<typeof runJournalEntryTests>,
  key: string
) {
  const hit = summary.results.find((r) => r.key === key);
  if (!hit) throw new Error(`테스트를 찾지 못함: ${key}`);
  return hit;
}

describe("주말·심야 전기", () => {
  it("토요일·일요일 전기를 잡는다", () => {
    const summary = runJournalEntryTests([
      je({ date: "2025-06-02" }), // 월
      je({ date: "2025-06-07" }), // 토
      je({ date: "2025-06-08" }), // 일
    ]);
    const weekend = testByKey(summary, "weekend");
    expect(weekend.flagCount).toBe(2);
    expect(weekend.flags[0].detail).toContain("토요일");
    expect(weekend.flags[1].detail).toContain("일요일");
  });

  it("22시~05시 전기를 잡고 업무시간은 잡지 않는다", () => {
    const summary = runJournalEntryTests([
      je({ time: "09:00" }),
      je({ time: "23:10" }),
      je({ time: "03:30" }),
      je({ time: "21:59" }),
    ]);
    expect(testByKey(summary, "late-night").flagCount).toBe(2);
  });

  it("엑셀 날짜 일련번호도 파싱한다", () => {
    // 45661 = 2025-01-04 (토요일)
    const summary = runJournalEntryTests([je({ date: "45661" })]);
    expect(summary.parsedDateCount).toBe(1);
    expect(testByKey(summary, "weekend").flagCount).toBe(1);
  });

  it("엑셀 시간(0~1 소수)도 파싱한다", () => {
    // 0.97 ≈ 23시대
    const summary = runJournalEntryTests([je({ time: "0.97" })]);
    expect(testByKey(summary, "late-night").flagCount).toBe(1);
  });

  it("날짜를 못 읽으면 그 행은 날짜 기반 테스트에서 빠진다", () => {
    const summary = runJournalEntryTests([je({ date: "" }), je({ date: "미상" })]);
    expect(summary.parsedDateCount).toBe(0);
  });
});

describe("라운드넘버", () => {
  it("100만원 이상이면서 100만원 단위로 딱 떨어지면 잡는다", () => {
    const summary = runJournalEntryTests([
      je({ debit: 5_000_000 }),
      je({ debit: 5_000_001 }),
      je({ debit: 500_000 }), // 딱 떨어져도 100만원 미만
      je({ debit: 1_234_567 }),
    ]);
    const round = testByKey(summary, "round-number");
    expect(round.flagCount).toBe(1);
    expect(round.flags[0].amount).toBe(5_000_000);
  });

  it("대변 금액도 본다", () => {
    const summary = runJournalEntryTests([je({ debit: 0, credit: 3_000_000 })]);
    expect(testByKey(summary, "round-number").flagCount).toBe(1);
  });
});

describe("적요 공란 · 자가승인", () => {
  it("적요가 비었거나 공백뿐이면 잡는다", () => {
    const summary = runJournalEntryTests([
      je({ memo: "정상" }),
      je({ memo: "" }),
      je({ memo: "   " }),
    ]);
    expect(testByKey(summary, "blank-memo").flagCount).toBe(2);
  });

  it("작성자와 승인자가 같으면 직무분리 위반으로 잡는다", () => {
    const summary = runJournalEntryTests([
      je({ preparer: "김대리", approver: "최부장" }),
      je({ preparer: "박과장", approver: "박과장" }),
    ]);
    const self = testByKey(summary, "self-approval");
    expect(self.flagCount).toBe(1);
    expect(self.flags[0].detail).toContain("박과장");
  });

  it("작성자·승인자가 둘 다 비어 있으면 자가승인으로 보지 않는다", () => {
    const summary = runJournalEntryTests([je({ preparer: "", approver: "" })]);
    expect(testByKey(summary, "self-approval").flagCount).toBe(0);
  });
});

describe("결산일 임박 전기", () => {
  const rows = [
    je({ date: "2025-06-30" }),
    je({ date: "2025-12-27" }),
    je({ date: "2025-12-31" }),
  ];

  it("결산일을 입력하면 그 기준 5일 이내를 잡는다", () => {
    const summary = runJournalEntryTests(rows, { periodEndDate: "2025-12-31" });
    const periodEnd = testByKey(summary, "period-end");
    expect(periodEnd.flagCount).toBe(2);
    expect(periodEnd.label).toContain("2025-12-31");
    expect(periodEnd.label).not.toContain("추정");
  });

  it("입력이 없으면 데이터상 최종일자로 추정하고 '추정'을 밝힌다", () => {
    // 기중 데이터만 올린 경우 이 추정이 정상 전표를 예외로 잡는다. 근거를
    // 숨기지 않고 라벨과 설명에 드러내야 감사인이 오해하지 않는다.
    const summary = runJournalEntryTests(rows);
    const periodEnd = testByKey(summary, "period-end");
    expect(periodEnd.label).toContain("추정");
    expect(periodEnd.description).toContain("결산일을 입력하지 않아");
  });

  it("입력한 결산일이 데이터 최종일자와 달라도 입력값을 우선한다", () => {
    const summary = runJournalEntryTests(rows, { periodEndDate: "2025-06-30" });
    const periodEnd = testByKey(summary, "period-end");
    expect(periodEnd.label).toContain("2025-06-30");
    expect(periodEnd.flagCount).toBe(1); // 6/30 한 건만
  });
});

describe("드물게 쓰는 계정", () => {
  it("전표 30건 미만이면 아예 수행하지 않는다 (표본 부족)", () => {
    const summary = runJournalEntryTests([je({ account: "잡손실" })]);
    expect(summary.results.find((r) => r.key === "rare-account")).toBeUndefined();
  });

  it("30건 이상이면 1회만 등장한 계정을 잡는다", () => {
    const rows = [
      ...Array.from({ length: 30 }, () => je({ account: "지급수수료" })),
      je({ account: "잡손실" }),
    ];
    const rare = testByKey(runJournalEntryTests(rows), "rare-account");
    expect(rare.flagCount).toBe(1);
    expect(rare.flags[0].account).toBe("잡손실");
  });
});

describe("승인한도 회피", () => {
  it("한도를 입력하지 않으면 테스트를 수행하지 않는다", () => {
    const summary = runJournalEntryTests([je({ debit: 990_000 })]);
    expect(summary.results.find((r) => r.key === "threshold")).toBeUndefined();
  });

  it("한도의 95%~한도 미만 금액을 잡는다", () => {
    const summary = runJournalEntryTests(
      [
        je({ debit: 990_000 }), // 한도 직전 → 잡힘
        je({ debit: 1_000_000 }), // 한도 자체 → 회피가 아님
        je({ debit: 800_000 }), // 한참 아래 → 정상
      ],
      { approvalLimit: 1_000_000 }
    );
    const threshold = testByKey(summary, "threshold");
    expect(threshold.flagCount).toBe(1);
    expect(threshold.flags[0].amount).toBe(990_000);
  });
});

describe("표시 제한 · 작성자 집중도", () => {
  it("예외항목은 50건까지만 보여주되 전체 건수는 그대로 알려준다", () => {
    const rows = Array.from({ length: 80 }, () => je({ memo: "" }));
    const blank = testByKey(runJournalEntryTests(rows), "blank-memo");
    expect(blank.flagCount).toBe(80);
    expect(blank.flags).toHaveLength(50);
  });

  it("작성자 상위 5명의 건수와 비중을 계산한다", () => {
    const rows = [
      ...Array.from({ length: 7 }, () => je({ preparer: "박과장" })),
      ...Array.from({ length: 3 }, () => je({ preparer: "김대리" })),
    ];
    const summary = runJournalEntryTests(rows);
    expect(summary.totalRows).toBe(10);
    expect(summary.preparerConcentration[0]).toMatchObject({
      name: "박과장",
      count: 7,
      percent: 70,
    });
  });

  it("작성자가 비어 있으면 '(미기재)'로 집계한다", () => {
    const summary = runJournalEntryTests([je({ preparer: "" })]);
    expect(summary.preparerConcentration[0].name).toBe("(미기재)");
  });

  it("상위 5명까지만 돌려준다", () => {
    const rows = ["A", "B", "C", "D", "E", "F"].map((p) => je({ preparer: p }));
    expect(runJournalEntryTests(rows).preparerConcentration).toHaveLength(5);
  });
});
