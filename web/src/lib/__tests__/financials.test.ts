import { describe, expect, it } from "vitest";
import {
  findAccountRow,
  findAccountValue,
  type StatementRow,
} from "../financials";

const row = (account: string, prior: number, current: number): StatementRow => ({
  account,
  prior,
  current,
});

describe("findAccountValue — 별칭 해석", () => {
  it("합계행 별칭이 세부계정보다 먼저 매칭된다", () => {
    // "유동자산"만으로 부분일치를 걸면 "기타유동자산"이 먼저 걸려 유동비율의
    // 분자가 엉뚱해진다. 합계행 후보를 앞에 둔 이유를 고정한다.
    const rows = [row("기타유동자산", 1, 2), row("유동자산합계", 10, 20)];
    expect(findAccountValue(rows, "유동자산", "current")).toBe(20);
  });

  it("공백을 무시하고 매칭한다", () => {
    const rows = [row("판매비와 관리비", 5, 7)];
    expect(findAccountValue(rows, "판매비와관리비", "current")).toBe(7);
  });

  it("계정이 없으면 null (0원과 구분)", () => {
    expect(findAccountValue([row("자산총계", 1, 2)], "재고자산", "current")).toBeNull();
  });

  it("전기/당기를 각각 읽는다", () => {
    const rows = [row("자산총계", 100, 200)];
    expect(findAccountValue(rows, "자산총계", "prior")).toBe(100);
    expect(findAccountValue(rows, "자산총계", "current")).toBe(200);
  });
});

describe("findAccountValue — 영업외손익 합산 (구성계정 분리 대응)", () => {
  it("DART식으로 기타수익·금융수익이 나뉘어 있으면 합산한다", () => {
    // 이 합산이 없으면 첫 매칭(기타수익)만 잡히고 금융수익이 통째로 누락된다.
    const rows = [row("기타수익", 100, 300), row("금융수익", 50, 200)];
    expect(findAccountValue(rows, "영업외수익", "current")).toBe(500);
    expect(findAccountValue(rows, "영업외수익", "prior")).toBe(150);
  });

  it("기타비용·금융비용도 동일하게 합산한다", () => {
    const rows = [row("기타비용", 10, 40), row("금융비용", 20, 60)];
    expect(findAccountValue(rows, "영업외비용", "current")).toBe(100);
  });

  it("합계행이 있으면 구성계정을 더하지 않는다 (이중계상 방지)", () => {
    const rows = [
      row("영업외수익", 0, 1000),
      row("기타수익", 0, 300),
      row("금융수익", 0, 200),
    ];
    expect(findAccountValue(rows, "영업외수익", "current")).toBe(1000);
  });

  it("한 행이 두 패턴에 걸려도 한 번만 더한다", () => {
    const rows = [row("기타비용(금융비용)", 0, 700)];
    expect(findAccountValue(rows, "영업외비용", "current")).toBe(700);
  });

  it("구성계정 중 하나만 있으면 그 값만 (기존 동작 유지)", () => {
    const rows = [row("기타수익", 0, 250)];
    expect(findAccountValue(rows, "영업외수익", "current")).toBe(250);
  });

  it("어느 쪽도 없으면 null", () => {
    expect(findAccountValue([row("매출액", 1, 2)], "영업외수익", "current")).toBeNull();
  });
});

describe("findAccountRow", () => {
  it("값이 아니라 행 자체를 돌려준다 (증감률 계산용)", () => {
    const rows = [row("매출채권및기타채권", 60, 226)];
    expect(findAccountRow(rows, "매출채권")?.account).toBe("매출채권및기타채권");
  });

  it("없으면 null", () => {
    expect(findAccountRow([row("매출액", 1, 2)], "재고자산")).toBeNull();
  });
});
