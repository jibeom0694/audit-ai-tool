import type { JournalRow } from "./excelParse";

// ISA 240(부정)에 따른 전표(JE) 부정위험 테스트. 각 테스트는 감사인이 추가로
// 들여다볼 "예외항목"을 뽑아주는 것이지, 그 자체로 부정을 확정하지 않는다.

export type JeFlag = {
  entryNo: string;
  date: string;
  account: string;
  amount: number;
  detail: string;
};

export type JeTestResult = {
  key: string;
  label: string;
  description: string;
  flagCount: number;
  flags: JeFlag[];
};

export type PreparerShare = {
  name: string;
  count: number;
  percent: number;
};

export type JeTestSummary = {
  totalRows: number;
  parsedDateCount: number;
  results: JeTestResult[];
  preparerConcentration: PreparerShare[];
};

const FLAG_DISPLAY_CAP = 50;

/** 전표 한 줄의 금액(차변 또는 대변 중 0이 아닌 쪽). */
function rowAmount(row: JournalRow): number {
  return Math.max(Math.abs(row.debit), Math.abs(row.credit));
}

/** 전기일자 문자열을 Date로 파싱한다. 텍스트(YYYY-MM-DD 등)와 엑셀 일련번호를
 * 모두 처리한다. 요일 판정 오차를 막기 위해 연·월·일을 뽑아 로컬 Date로 만든다. */
function parseEntryDate(raw: string): Date | null {
  const s = String(raw).trim();
  if (!s) return null;

  // 엑셀 날짜 일련번호 (예: 45992)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 59) {
      const utc = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return new Date(
        utc.getUTCFullYear(),
        utc.getUTCMonth(),
        utc.getUTCDate()
      );
    }
    return null;
  }

  // YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD
  const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 전기시각 문자열에서 '시(0~23)'를 뽑는다. HH:MM 텍스트와 엑셀 시간(0~1 소수)
 * 모두 처리한다. */
function parseEntryHour(raw: string): number | null {
  const s = String(raw).trim();
  if (!s) return null;

  const hm = s.match(/^(\d{1,2}):(\d{2})/);
  if (hm) {
    const h = Number(hm[1]);
    return h >= 0 && h <= 23 ? h : null;
  }

  const n = Number(s);
  if (Number.isFinite(n)) {
    if (n > 0 && n < 1) return Math.floor(n * 24); // 엑셀 시간 소수
    if (n >= 0 && n <= 23) return Math.floor(n);
  }
  return null;
}

function toFlag(row: JournalRow, detail: string): JeFlag {
  return {
    entryNo: row.entryNo,
    date: row.date,
    account: row.account,
    amount: rowAmount(row),
    detail,
  };
}

function buildResult(
  key: string,
  label: string,
  description: string,
  flags: JeFlag[]
): JeTestResult {
  return {
    key,
    label,
    description,
    flagCount: flags.length,
    flags: flags.slice(0, FLAG_DISPLAY_CAP),
  };
}

export function runJournalEntryTests(
  rows: JournalRow[],
  options: { approvalLimit?: number } = {}
): JeTestSummary {
  const { approvalLimit = 0 } = options;
  const results: JeTestResult[] = [];

  // 1. 주말 전기
  const weekendFlags: JeFlag[] = [];
  let parsedDateCount = 0;
  for (const row of rows) {
    const d = parseEntryDate(row.date);
    if (!d) continue;
    parsedDateCount += 1;
    const day = d.getDay();
    if (day === 0 || day === 6) {
      weekendFlags.push(toFlag(row, `${day === 0 ? "일요일" : "토요일"} 전기`));
    }
  }
  results.push(
    buildResult(
      "weekend",
      "주말 전기",
      "정상 영업일이 아닌 토·일요일에 입력된 전표. 통제 밖에서 처리됐을 가능성을 검토합니다.",
      weekendFlags
    )
  );

  // 2. 심야 전기 (22시~05시)
  const lateNightFlags: JeFlag[] = [];
  for (const row of rows) {
    const h = parseEntryHour(row.time);
    if (h == null) continue;
    if (h >= 22 || h < 6) {
      lateNightFlags.push(toFlag(row, `${String(h).padStart(2, "0")}시대 전기`));
    }
  }
  results.push(
    buildResult(
      "late-night",
      "심야 시간대 전기 (22~05시)",
      "업무시간 외 심야에 입력된 전표. 승인·검토 없이 처리됐을 위험을 봅니다.",
      lateNightFlags
    )
  );

  // 3. 라운드넘버 (백만원 단위로 딱 떨어지는 큰 금액)
  const roundFlags: JeFlag[] = [];
  for (const row of rows) {
    const amount = rowAmount(row);
    if (amount >= 1_000_000 && amount % 1_000_000 === 0) {
      roundFlags.push(toFlag(row, `${amount.toLocaleString()}원 (백만원 단위)`));
    }
  }
  results.push(
    buildResult(
      "round-number",
      "라운드넘버 금액",
      "실제 거래는 단수가 붙는 경우가 많은데, 백만원 단위로 딱 떨어지는 금액은 추정·조작 가능성을 검토합니다.",
      roundFlags
    )
  );

  // 4. 적요 공란
  const blankMemoFlags: JeFlag[] = [];
  for (const row of rows) {
    if (String(row.memo).trim() === "") {
      blankMemoFlags.push(toFlag(row, "적요(설명) 없음"));
    }
  }
  results.push(
    buildResult(
      "blank-memo",
      "적요 공란",
      "거래 설명이 비어 있는 전표. 근거·목적이 불분명한 분개일 수 있습니다.",
      blankMemoFlags
    )
  );

  // 5. 작성자 = 승인자 (직무분리 위반 / 승인 무력화)
  const selfApprovalFlags: JeFlag[] = [];
  for (const row of rows) {
    const preparer = String(row.preparer).trim();
    const approver = String(row.approver).trim();
    if (preparer !== "" && preparer === approver) {
      selfApprovalFlags.push(toFlag(row, `작성=승인 동일 (${preparer})`));
    }
  }
  results.push(
    buildResult(
      "self-approval",
      "작성자 = 승인자",
      "동일인이 작성·승인한 전표. 직무분리(SoD)가 지켜지지 않아 경영진의 통제 무력화 위험이 있습니다.",
      selfApprovalFlags
    )
  );

  // 6. 결산일 임박 전기 (데이터상 최종일 기준 5일 이내)
  const dates = rows
    .map((r) => parseEntryDate(r.date))
    .filter((d): d is Date => d != null);
  const periodEndFlags: JeFlag[] = [];
  let periodEndLabel = "";
  if (dates.length > 0) {
    const maxTime = Math.max(...dates.map((d) => d.getTime()));
    const periodEnd = new Date(maxTime);
    periodEndLabel = `${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, "0")}-${String(periodEnd.getDate()).padStart(2, "0")}`;
    const windowStart = maxTime - 5 * 86400000;
    for (const row of rows) {
      const d = parseEntryDate(row.date);
      if (!d) continue;
      if (d.getTime() >= windowStart && d.getTime() <= maxTime) {
        periodEndFlags.push(toFlag(row, "결산일 임박 5일 이내 전기"));
      }
    }
  }
  results.push(
    buildResult(
      "period-end",
      `결산일 임박 전기${periodEndLabel ? ` (추정 결산일 ${periodEndLabel})` : ""}`,
      "기간 말에 집중된 전표. 목표 실적을 맞추기 위한 마감 조정분개가 섞였을 수 있습니다.",
      periodEndFlags
    )
  );

  // 7. 드물게 쓰는 계정 (전표가 30건 이상일 때, 1회만 등장한 계정)
  if (rows.length >= 30) {
    const accountCount = new Map<string, number>();
    for (const row of rows) {
      const acc = String(row.account).trim();
      if (acc) accountCount.set(acc, (accountCount.get(acc) ?? 0) + 1);
    }
    const rareFlags: JeFlag[] = [];
    for (const row of rows) {
      const acc = String(row.account).trim();
      if (acc && accountCount.get(acc) === 1) {
        rareFlags.push(toFlag(row, "이 계정은 전 기간 1회만 사용됨"));
      }
    }
    results.push(
      buildResult(
        "rare-account",
        "드물게 쓰는 계정",
        "전 기간에 한 번만 등장한 계정. 평소 안 쓰는 계정으로 분개를 숨겼을 가능성을 검토합니다.",
        rareFlags
      )
    );
  }

  // 8. 승인한도 바로 아래 금액 (한도 입력 시에만)
  if (approvalLimit > 0) {
    const lowerBound = approvalLimit * 0.95;
    const thresholdFlags: JeFlag[] = [];
    for (const row of rows) {
      const amount = rowAmount(row);
      if (amount >= lowerBound && amount < approvalLimit) {
        thresholdFlags.push(
          toFlag(
            row,
            `승인한도(${approvalLimit.toLocaleString()}원) 바로 아래 금액`
          )
        );
      }
    }
    results.push(
      buildResult(
        "threshold",
        "승인한도 바로 아래 금액",
        "상위 승인을 피하려고 한도 직전 금액으로 쪼갠 전표(splitting) 가능성을 검토합니다.",
        thresholdFlags
      )
    );
  }

  // 작성자 집중도 (상위 5명)
  const preparerCount = new Map<string, number>();
  for (const row of rows) {
    const name = String(row.preparer).trim() || "(미기재)";
    preparerCount.set(name, (preparerCount.get(name) ?? 0) + 1);
  }
  const preparerConcentration: PreparerShare[] = [...preparerCount.entries()]
    .map(([name, count]) => ({
      name,
      count,
      percent: rows.length > 0 ? (count / rows.length) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalRows: rows.length,
    parsedDateCount,
    results,
    preparerConcentration,
  };
}
