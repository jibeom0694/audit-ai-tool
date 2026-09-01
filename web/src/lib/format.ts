// 화면·조서에 금액과 비율을 표시하는 규칙. page.tsx와 각 탭 컴포넌트가 함께
// 쓰므로 별도 모듈로 둔다(표시 규칙이 갈라지면 같은 숫자가 화면마다 다르게 보인다).

export function formatAmount(value?: number) {
  return value != null ? value.toLocaleString() : "-";
}

/** 값이 없을 때 0으로 보이면 "0원"으로 오해하므로 명시적으로 데이터 부족이라 쓴다. */
export function formatRatioValue(value: number | null, unit: "%" | "배" | "원") {
  if (value == null) return "데이터 부족";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "배") return `${value.toFixed(2)}배`;
  return `${Math.round(value).toLocaleString()}원`;
}

/** 상장기업(DART)은 규모가 커서 백만원 단위, 비상장기업(엑셀 업로드·AI
 * 인식)은 상대적으로 규모가 작은 경우가 많아 천원 단위로 환산해 보여준다. */
export type AmountUnit = "million" | "thousand";

export function formatAmountByUnit(value: number, unit: AmountUnit): string {
  const divisor = unit === "million" ? 1_000_000 : 1_000;
  return Math.round(value / divisor).toLocaleString();
}

export function amountUnitLabel(unit: AmountUnit): string {
  return unit === "million" ? "백만원" : "천원";
}
