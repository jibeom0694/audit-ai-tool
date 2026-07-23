import * as XLSX from "xlsx";
import { JOURNAL_SHEET, STATEMENT_SHEETS } from "./excelTemplate";

export type ParsedStatementRow = {
  계정과목: string;
  전기: number;
  당기: number;
};

/** 전표데이터 시트 한 행. 이상탐지 모델(Benford's Law·RSF 테스트·순환거래
 * 탐지)은 재무제표 요약이 아니라 이 거래 단위 데이터가 있어야 계산할 수
 * 있다 — DART·Upstage 경로는 거래 단위 데이터를 제공하지 않으므로 이 항목이
 * 있는 엑셀 업로드 경로에서만 해당 모델들이 동작한다. */
export type JournalRow = {
  entryNo: string;
  date: string;
  time: string;
  account: string;
  counterparty: string;
  debit: number;
  credit: number;
  preparer: string;
  approver: string;
  memo: string;
};

export type ParsedFinancials = {
  sheets: Partial<Record<(typeof STATEMENT_SHEETS)[number], ParsedStatementRow[]>>;
  journalRows: JournalRow[];
  journalRowCount: number;
  missingSheets: string[];
};

/**
 * 표준 템플릿(계정과목/전기/당기 컬럼 순서 고정)을 브라우저에서 직접 파싱한다.
 * 서버/DB 없이 클라이언트에서만 처리 (지금 단계는 DB 연동 전).
 */
export async function parseFinancialTemplate(
  file: File
): Promise<ParsedFinancials> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });

  const sheets: ParsedFinancials["sheets"] = {};
  const missingSheets: string[] = [];

  for (const sheetName of STATEMENT_SHEETS) {
    const ws = wb.Sheets[sheetName];
    if (!ws) {
      missingSheets.push(sheetName);
      continue;
    }
    const raw = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
      header: 1,
    });
    const dataRows = raw.slice(1).filter((row) => row && row[0] !== undefined && row[0] !== "");
    sheets[sheetName] = dataRows.map((row) => ({
      계정과목: String(row[0] ?? ""),
      전기: Number(row[1] ?? 0) || 0,
      당기: Number(row[2] ?? 0) || 0,
    }));
  }

  let journalRows: JournalRow[] = [];
  const journalWs = wb.Sheets[JOURNAL_SHEET];
  if (journalWs) {
    const journalRaw = XLSX.utils.sheet_to_json<(string | number)[]>(
      journalWs,
      { header: 1 }
    );
    const dataRows = journalRaw
      .slice(1)
      .filter((row) => row && row[0] !== undefined && row[0] !== "");
    // 컬럼 순서는 excelTemplate.ts의 JOURNAL_HEADERS와 반드시 일치해야 한다:
    // 전표번호, 전기일자, 전기시각, 계정과목, 거래처, 차변, 대변, 작성자, 승인자, 적요
    journalRows = dataRows.map((row) => ({
      entryNo: String(row[0] ?? ""),
      date: String(row[1] ?? ""),
      time: String(row[2] ?? ""),
      account: String(row[3] ?? ""),
      counterparty: String(row[4] ?? ""),
      debit: Number(row[5] ?? 0) || 0,
      credit: Number(row[6] ?? 0) || 0,
      preparer: String(row[7] ?? ""),
      approver: String(row[8] ?? ""),
      memo: String(row[9] ?? ""),
    }));
  } else {
    missingSheets.push(JOURNAL_SHEET);
  }

  return {
    sheets,
    journalRows,
    journalRowCount: journalRows.length,
    missingSheets,
  };
}
