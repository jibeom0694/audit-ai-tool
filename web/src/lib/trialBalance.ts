import * as XLSX from "xlsx";

// 시산표(Trial Balance) 업로드·검증. 감사인이 클라이언트 총계정원장에서 뽑은
// 시산표를 받아, 그 시산표 자체가 무결한지(차대변 균형·계정별 roll-forward)를
// 먼저 확인한다. 이 검증을 통과해야 이후 분석·표본추출의 기초로 신뢰할 수 있다.
//
// 금액 규약: 잔액(기초·기말)은 차변 양수(+), 대변 음수(−)의 부호형(signed)으로
// 입력한다. 이렇게 하면 전체 기말잔액 합계가 0이어야 한다는 단순한 균형식으로
// 검증할 수 있다. 당기차변·당기대변은 각각 0 이상의 발생액이다.

export const TB_SHEET = "시산표";
export const TB_HEADERS = [
  "계정코드",
  "계정과목",
  "기초잔액",
  "당기차변",
  "당기대변",
  "기말잔액",
];

export type TrialBalanceRow = {
  code: string;
  account: string;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
};

export type RollForwardMismatch = {
  code: string;
  account: string;
  expected: number;
  closing: number;
  diff: number;
};

export type TbCheckResult = {
  rowCount: number;
  closingBalanceSum: number;
  isBalanced: boolean;
  periodDebitTotal: number;
  periodCreditTotal: number;
  periodActivityBalanced: boolean;
  rollForwardMismatches: RollForwardMismatch[];
};

// 원 단위 반올림 오차 1원까지는 균형으로 본다.
const TOLERANCE = 1;

export async function parseTrialBalance(
  file: File
): Promise<TrialBalanceRow[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  // "시산표" 시트를 우선 찾고, 없으면 첫 시트를 시산표로 간주한다(단일 시트
  // export도 흔하기 때문).
  const ws = wb.Sheets[TB_SHEET] ?? wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const raw = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1 });
  const dataRows = raw
    .slice(1)
    .filter(
      (row) =>
        row &&
        ((row[0] !== undefined && row[0] !== "") ||
          (row[1] !== undefined && row[1] !== ""))
    );

  return dataRows.map((row) => ({
    code: String(row[0] ?? ""),
    account: String(row[1] ?? ""),
    opening: Number(row[2] ?? 0) || 0,
    debit: Number(row[3] ?? 0) || 0,
    credit: Number(row[4] ?? 0) || 0,
    closing: Number(row[5] ?? 0) || 0,
  }));
}

export function checkTrialBalance(rows: TrialBalanceRow[]): TbCheckResult {
  let closingSum = 0;
  let debitTotal = 0;
  let creditTotal = 0;
  const mismatches: RollForwardMismatch[] = [];

  for (const r of rows) {
    closingSum += r.closing;
    debitTotal += r.debit;
    creditTotal += r.credit;
    const expected = r.opening + r.debit - r.credit;
    if (Math.abs(expected - r.closing) > TOLERANCE) {
      mismatches.push({
        code: r.code,
        account: r.account,
        expected,
        closing: r.closing,
        diff: r.closing - expected,
      });
    }
  }

  return {
    rowCount: rows.length,
    closingBalanceSum: closingSum,
    isBalanced: Math.abs(closingSum) <= TOLERANCE,
    periodDebitTotal: debitTotal,
    periodCreditTotal: creditTotal,
    periodActivityBalanced: Math.abs(debitTotal - creditTotal) <= TOLERANCE,
    rollForwardMismatches: mismatches,
  };
}

/** 표준 시산표 템플릿(부호형 잔액 규약을 보여주는 균형 잡힌 예시 4행)을
 * 브라우저에서 생성해 다운로드한다. */
export function downloadTrialBalanceTemplate(): void {
  const sample: (string | number)[][] = [
    TB_HEADERS,
    ["101", "현금및현금성자산", 10000000, 5000000, 3000000, 12000000],
    ["108", "매출채권", 8000000, 2000000, 1000000, 9000000],
    ["251", "매입채무", -6000000, 1000000, 2000000, -7000000],
    ["331", "자본금", -12000000, 0, 2000000, -14000000],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, TB_SHEET);
  XLSX.writeFile(wb, "시산표_템플릿.xlsx");
}
