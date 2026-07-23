import * as XLSX from "xlsx";
import {
  JOURNAL_HEADERS,
  JOURNAL_SHEET,
  STATEMENT_ACCOUNTS,
  STATEMENT_SHEETS,
} from "@/lib/excelTemplate";

export async function GET() {
  const wb = XLSX.utils.book_new();

  for (const sheetName of STATEMENT_SHEETS) {
    const rows: (string | number)[][] = [["계정과목", "전기", "당기"]];
    for (const account of STATEMENT_ACCOUNTS[sheetName]) {
      rows.push([account, 0, 0]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const journalWs = XLSX.utils.aoa_to_sheet([JOURNAL_HEADERS]);
  journalWs["!cols"] = JOURNAL_HEADERS.map(() => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, journalWs, JOURNAL_SHEET);

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="financial_template.xlsx"',
    },
  });
}
