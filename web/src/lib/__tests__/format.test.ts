import { describe, expect, it } from "vitest";
import {
  amountUnitLabel,
  formatAmount,
  formatAmountByUnit,
  formatRatioValue,
  parsePercentInput,
} from "../format";

describe("formatAmount", () => {
  it("천 단위 구분자를 넣는다", () => {
    expect(formatAmount(1_234_567)).toBe("1,234,567");
  });

  it("값이 없으면 '-'", () => {
    expect(formatAmount(undefined)).toBe("-");
  });

  it("0은 '-'가 아니라 0으로 표시한다", () => {
    expect(formatAmount(0)).toBe("0");
  });
});

describe("formatRatioValue", () => {
  it("값이 없으면 '데이터 부족' (0%로 보이면 오해를 부른다)", () => {
    expect(formatRatioValue(null, "%")).toBe("데이터 부족");
    expect(formatRatioValue(null, "배")).toBe("데이터 부족");
  });

  it("%는 소수 첫째 자리까지", () => {
    expect(formatRatioValue(123.456, "%")).toBe("123.5%");
  });

  it("배수는 소수 둘째 자리까지", () => {
    expect(formatRatioValue(4.1234, "배")).toBe("4.12배");
  });

  it("원 단위는 반올림하고 구분자를 넣는다", () => {
    expect(formatRatioValue(1234.6, "원")).toBe("1,235원");
  });

  it("음수도 그대로 표시한다 (적자·자본잠식)", () => {
    expect(formatRatioValue(-12.34, "%")).toBe("-12.3%");
  });
});

describe("formatAmountByUnit", () => {
  it("백만원 단위로 환산한다", () => {
    expect(formatAmountByUnit(1_234_567_890, "million")).toBe("1,235");
  });

  it("천원 단위로 환산한다", () => {
    expect(formatAmountByUnit(1_234_567, "thousand")).toBe("1,235");
  });

  it("단위 미만은 반올림한다", () => {
    expect(formatAmountByUnit(400_000, "million")).toBe("0");
    expect(formatAmountByUnit(600_000, "million")).toBe("1");
  });

  it("음수(부채·자본의 부호형 잔액)도 처리한다", () => {
    expect(formatAmountByUnit(-7_000_000, "million")).toBe("-7");
  });
});

describe("amountUnitLabel", () => {
  it("화면 표기용 한글 단위를 돌려준다", () => {
    expect(amountUnitLabel("million")).toBe("백만원");
    expect(amountUnitLabel("thousand")).toBe("천원");
  });
});

describe("parsePercentInput", () => {
  it("% 기호가 붙어도 수치를 읽는다", () => {
    // 라벨이 "예상오류율 (%)"이라 사용자는 "%"를 함께 쓴다. Number("0.5%")는
    // NaN이라, 이걸 처리하지 않으면 입력값이 조용히 0으로 떨어진다.
    expect(parsePercentInput("0.5%")).toBe(0.5);
    expect(parsePercentInput("0.5 %")).toBe(0.5);
    expect(parsePercentInput("0.5")).toBe(0.5);
  });

  it("정수·소수 모두 처리한다", () => {
    expect(parsePercentInput("5")).toBe(5);
    expect(parsePercentInput("12.75")).toBe(12.75);
  });

  it("빈 값이나 숫자가 없는 문자열은 0", () => {
    expect(parsePercentInput("")).toBe(0);
    expect(parsePercentInput("   ")).toBe(0);
    expect(parsePercentInput("미정")).toBe(0);
    expect(parsePercentInput("%")).toBe(0);
  });

  it("음수 비율은 0으로 본다", () => {
    // 음수를 허용하면 허용왜곡이 되레 커져 표본이 줄어든다 — 감사위험이 오른다.
    expect(parsePercentInput("-1")).toBe(0);
    expect(parsePercentInput("-0.5%")).toBe(0);
  });

  it("앞뒤에 설명이 붙어도 첫 수치를 읽는다", () => {
    expect(parsePercentInput("약 1.5% 예상")).toBe(1.5);
  });
});
