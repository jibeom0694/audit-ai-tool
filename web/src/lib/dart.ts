import "server-only";

import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import type { NormalizedFinancials, StatementRow } from "./financials";

const BASE_URL = "https://opendart.fss.or.kr/api";
const CACHE_PATH = path.join(process.cwd(), "data", "corp-codes.json");

export type CorpCode = {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  modify_date: string;
};

export const REPRT_CODE_LABELS: Record<string, string> = {
  "11011": "사업보고서",
  "11012": "반기보고서",
  "11014": "3분기보고서",
  "11013": "1분기보고서",
};

export const FS_DIV_LABELS: Record<string, string> = {
  OFS: "개별재무제표",
  CFS: "연결재무제표",
};

async function fetchCorpCodesFromDart(): Promise<CorpCode[]> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    throw new Error("DART_API_KEY가 설정되어 있지 않습니다 (.env.local 확인).");
  }

  const res = await fetch(
    `${BASE_URL}/corpCode.xml?crtfc_key=${encodeURIComponent(apiKey)}`
  );
  if (!res.ok) {
    throw new Error(`DART corpCode 요청 실패: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("CORPCODE.xml");
  if (!entry) {
    throw new Error("CORPCODE.xml 항목을 찾을 수 없습니다.");
  }

  const xml = entry.getData().toString("utf-8");
  // parseTagValue: false — corp_code/stock_code는 앞자리 0이 의미 있는 문자열이라
  // 숫자로 자동 변환되면 안 됨 (예: "00126380" -> 126380 방지)
  const parser = new XMLParser({ parseTagValue: false });
  const parsed = parser.parse(xml);
  const rawList = parsed?.result?.list ?? [];
  const list = Array.isArray(rawList) ? rawList : [rawList];

  return list.map((item: Record<string, unknown>) => ({
    corp_code: String(item.corp_code ?? ""),
    corp_name: String(item.corp_name ?? ""),
    stock_code: String(item.stock_code ?? "").trim(),
    modify_date: String(item.modify_date ?? ""),
  }));
}

/**
 * corpCode 목록은 매 요청마다 DART에서 재다운로드하지 않고 로컬 JSON 파일에
 * 캐싱한다. (Supabase 연동 전 임시 방식 — PRD FR-1.2 참고)
 *
 * 이 캐시 파일은 정상적으로는 배포 전 "prebuild" 스크립트(scripts/build-corp-codes.js)가
 * 미리 만들어 두므로 여기서는 읽기만 하면 된다. 로컬 최초 실행 등 그 파일이 없는
 * 경우에만 여기서 직접 받아 캐싱을 "시도"한다 — 단, Vercel 배포본처럼 파일시스템이
 * 읽기 전용이라 캐시 쓰기가 실패하더라도(EROFS 등) 방금 받아온 목록 자체는 정상
 * 반환한다. 쓰기를 못 했다고 검색 기능 전체가 죽으면 안 되기 때문이다.
 */
export async function loadCorpCodes(): Promise<CorpCode[]> {
  if (fs.existsSync(CACHE_PATH)) {
    const cached = fs.readFileSync(CACHE_PATH, "utf-8");
    return JSON.parse(cached);
  }

  const corpCodes = await fetchCorpCodesFromDart();
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(corpCodes), "utf-8");
  } catch {
    // 읽기 전용 파일시스템(예: Vercel 서버리스 런타임)에서는 캐싱을 건너뛰고
    // 방금 받아온 목록으로 이번 요청은 정상 처리한다.
  }
  return corpCodes;
}

export function searchCorpCodes(
  corpCodes: CorpCode[],
  keyword: string,
  limit = 20
): CorpCode[] {
  const trimmed = keyword.trim();
  if (!trimmed) return [];

  const matches = corpCodes.filter((c) => c.corp_name.includes(trimmed));
  // 상장기업(종목코드 존재)을 우선 노출
  matches.sort((a, b) => {
    const aListed = a.stock_code ? 0 : 1;
    const bListed = b.stock_code ? 0 : 1;
    return aListed - bListed;
  });
  return matches.slice(0, limit);
}

function parseAmount(value: unknown): number {
  if (value == null || value === "") return 0;
  const num = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(num) ? num : 0;
}

// 표준 손익계산서(기능별) 표시 순서. 계정명이 포함하는 첫 키워드의 인덱스를
// 우선순위로 쓴다. "법인세비용차감전"은 "법인세비용"보다 앞에 둬야 더 구체적인
// 항목이 먼저 매칭된다.
const IS_PRESENTATION_ORDER = [
  "매출액",
  "영업수익",
  "매출원가",
  "매출총이익",
  "판매비와관리비",
  "영업이익",
  "영업손실",
  "기타수익",
  "기타비용",
  "금융수익",
  "금융비용",
  "지분법",
  "법인세비용차감전",
  "법인세비용",
  "계속영업",
  "중단영업",
  "당기순이익",
  "당기순손실",
  "총포괄",
  "주당이익",
];

function incomeStatementRank(accountName: string): number {
  const name = accountName.replace(/\s/g, "");
  const idx = IS_PRESENTATION_ORDER.findIndex((kw) => name.includes(kw));
  return idx === -1 ? IS_PRESENTATION_ORDER.length : idx;
}

/**
 * 단일회사 전체 재무제표(fnlttSinglAcntAll)를 조회해 재무상태표(BS)/손익계산서
 * (IS 또는 연결 CIS)만 표준 구조로 정규화한다. DART의 계정명(account_nm)은
 * 회사마다 표기가 조금씩 달라서(예: "영업이익(손실)") financials.ts의
 * ACCOUNT_ALIASES가 이를 흡수한다.
 */
export async function fetchFinancialStatements(
  corpCode: string,
  bsnsYear: string,
  reprtCode: string,
  fsDiv: "OFS" | "CFS"
): Promise<NormalizedFinancials> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    throw new Error("DART_API_KEY가 설정되어 있지 않습니다 (.env.local 확인).");
  }

  const params = new URLSearchParams({
    crtfc_key: apiKey,
    corp_code: corpCode,
    bsns_year: bsnsYear,
    reprt_code: reprtCode,
    fs_div: fsDiv,
  });

  const res = await fetch(`${BASE_URL}/fnlttSinglAcntAll.json?${params}`);
  if (!res.ok) {
    throw new Error(`DART 재무제표 요청 실패: ${res.status}`);
  }

  const data = await res.json();
  if (data.status !== "000") {
    throw new Error(`DART API 오류 ${data.status}: ${data.message}`);
  }

  const list: Array<Record<string, unknown>> = data.list ?? [];
  const bs: StatementRow[] = [];
  const isRows: StatementRow[] = [];
  const cisRows: StatementRow[] = [];
  const cf: StatementRow[] = [];

  for (const item of list) {
    const ordValue = Number(item.ord);
    const row: StatementRow = {
      account: String(item.account_nm ?? ""),
      prior: parseAmount(item.frmtrm_amount),
      current: parseAmount(item.thstrm_amount),
      ord: Number.isFinite(ordValue) ? ordValue : undefined,
    };
    if (item.sj_div === "BS") {
      bs.push(row);
    } else if (item.sj_div === "IS") {
      isRows.push(row);
    } else if (item.sj_div === "CIS") {
      cisRows.push(row);
    } else if (item.sj_div === "CF") {
      cf.push(row);
    }
  }

  // DART는 손익계산서(IS)와 포괄손익계산서(CIS)를 함께 내려주는데, 두 표는
  // "당기순이익" 등 일부 계정이 겹친다. 두 배열을 합치면 중복 표시되므로
  // IS가 있으면 IS만, 없으면(일부 회사는 CIS만 제공) CIS로 대체한다.
  const is = isRows.length > 0 ? isRows : cisRows;

  // 재무상태표·현금흐름표는 DART가 내려주는 ord가 실제 양식 순서와 일치하므로
  // 그대로 정렬한다.
  const byOrd = (a: StatementRow, b: StatementRow) =>
    (a.ord ?? 0) - (b.ord ?? 0);
  bs.sort(byOrd);
  cf.sort(byOrd);

  // 손익계산서(IS/CIS)의 ord는 표시 순서가 아니라 XBRL 태그 순서라, 그대로
  // 정렬하면 매출액이 맨 뒤에 오는 등 실제 손익계산서 양식과 다르게 나온다.
  // 계정명을 기준으로 표준 손익계산서 흐름(매출액 − 매출원가 = 매출총이익 …)에
  // 맞춰 재정렬한다.
  is.sort((a, b) => {
    const ra = incomeStatementRank(a.account);
    const rb = incomeStatementRank(b.account);
    if (ra !== rb) return ra - rb;
    return (a.ord ?? 0) - (b.ord ?? 0);
  });

  return { bs, is, cf: cf.length > 0 ? cf : undefined };
}

export type Disclosure = {
  reportName: string;
  receiptNo: string;
  receiptDate: string;
  filerName: string;
};

/**
 * 공시 목록(list.json)을 최신순으로 조회한다. 공시 원문(document.xml, HWP 변환
 * 필요)까지는 파싱하지 않고 제목만 쓴다 — 제목이 DART가 정한 정형 문구라
 * 감사 관점 분류에는 충분하다(disclosureRisk.ts).
 *
 * 조회 창은 호출자가 정한다. 기본값(오늘 기준 1년)은 감사 대상 사업연도와
 * 무관하게 흘러가므로, 감사 화면에서는 결산일 기준 창을 넘겨야 한다.
 */
export async function fetchRecentDisclosures(
  corpCode: string,
  count = 10,
  range?: { bgnDe: string; endDe: string }
): Promise<Disclosure[]> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    throw new Error("DART_API_KEY가 설정되어 있지 않습니다 (.env.local 확인).");
  }

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

  let bgnDe: string;
  let endDe: string;
  if (range) {
    ({ bgnDe, endDe } = range);
  } else {
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    bgnDe = fmt(oneYearAgo);
    endDe = fmt(today);
  }

  const params = new URLSearchParams({
    crtfc_key: apiKey,
    corp_code: corpCode,
    bgn_de: bgnDe,
    end_de: endDe,
    page_no: "1",
    page_count: String(count),
    sort: "date",
    sort_mth: "desc",
  });

  const res = await fetch(`${BASE_URL}/list.json?${params}`);
  if (!res.ok) {
    throw new Error(`DART 공시목록 요청 실패: ${res.status}`);
  }

  const data = await res.json();
  if (data.status !== "000") {
    if (data.status === "013") return []; // 조회된 데이터가 없는 경우
    throw new Error(`DART API 오류 ${data.status}: ${data.message}`);
  }

  const list: Array<Record<string, unknown>> = data.list ?? [];
  return list.map((item) => ({
    reportName: String(item.report_nm ?? ""),
    receiptNo: String(item.rcept_no ?? ""),
    receiptDate: String(item.rcept_dt ?? ""),
    filerName: String(item.flr_nm ?? ""),
  }));
}
