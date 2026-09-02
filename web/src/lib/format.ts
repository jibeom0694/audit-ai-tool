// 사용자가 보는 문자열과 계산에 쓰는 숫자 사이의 경계. 표시(숫자 → 문자열)와
// 입력 파싱(문자열 → 숫자)을 한곳에 모아둔다 — 규칙이 갈라지면 같은 숫자가
// 화면마다 다르게 보이거나, 입력한 값이 계산에 반영되지 않는다.

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

/**
 * 비율(%) 입력창의 문자열에서 숫자를 뽑는다.
 *
 * 라벨이 "예상오류율 (%)"이면 사용자는 "0.5%"라고 쓰는 게 자연스럽다. 그런데
 * `Number("0.5%")`는 NaN이라, `Number(...) || 0` 식으로 파싱하면 **입력값이
 * 조용히 0으로 떨어진다.** 감사 도구에서 이런 무성 실패가 가장 위험하다 —
 * 오류 표시 없이 표본크기만 과소 산출되기 때문이다(실제로 예상오류율 0.5%가
 * 무시돼 표본이 49건 대신 42건으로 나오던 버그가 있었다).
 *
 * 그래서 단위 기호·공백을 무시하고 첫 번째 수치만 읽는다. 음수 비율은 의미가
 * 없으므로 0으로 본다(음수면 허용왜곡이 되레 커져 표본이 줄어든다).
 */
export function parsePercentInput(value: string): number {
  const matched = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  if (!matched) return 0;
  const parsed = Number(matched[0]);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}
