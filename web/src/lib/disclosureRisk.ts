// DART 공시 제목을 감사 관점으로 분류한다.
//
// 왜 LLM이 아니라 규칙인가:
// 공시 제목(report_nm)은 DART가 정한 정형 문구라서 사람이 쓴 자유 문장이 아니다.
// "[기재정정]사업보고서", "횡령ㆍ배임혐의발생"처럼 유형이 제목에 그대로 박혀 있어,
// 문자열 규칙만으로 충분히 갈라진다. LLM을 태우면 (1) 같은 입력에 다른 출력이
// 나오고 (2) 근거를 되짚을 수 없고 (3) API 키와 제3자 전송 동의에 묶인다.
// 감사조서에 남길 근거로는 "어떤 규칙에 걸렸는지"가 재현되는 쪽이 낫다.
//
// 여기서 붙이는 ISA 번호는 LLM 산출물이 아니라 이 파일에 하드코딩한 상수다.
// 그래도 isaStandards.ts의 화이트리스트에 실재하는 번호인지는 테스트로 강제한다.

/** 감사인이 공시를 훑을 때 실제로 갈라 보는 단위. */
export type DisclosureCategory =
  | "정정공시"
  | "부정혐의"
  | "계속기업"
  | "감사보고"
  | "소송·분쟁"
  | "특수관계자"
  | "자본거래"
  | "지배구조"
  | "정기공시"
  | "기타";

/**
 * high  = 그 자체로 왜곡위험 신호. 감사절차를 바꿔야 할 수 있다.
 * medium= 확인이 필요한 사건. 관련 계정·주석을 짚어봐야 한다.
 * info  = 정기·통상 공시. 목록에서 배경으로 깔린다.
 */
export type DisclosureSeverity = "high" | "medium" | "info";

export type DisclosureFlag = {
  category: DisclosureCategory;
  severity: DisclosureSeverity;
  /** 왜 이 분류가 됐는지. 조서에 그대로 옮길 수 있게 규칙 근거를 문장으로 남긴다. */
  reason: string;
  /** 관련 감사기준서 번호. isaStandards 화이트리스트에 실재하는 것만 쓴다. */
  isaRefs: string[];
};

type Rule = {
  category: DisclosureCategory;
  severity: DisclosureSeverity;
  /** 제목에 이 중 하나라도 들어 있으면 매칭. 공백을 제거한 제목과 비교한다. */
  patterns: string[];
  reason: string;
  isaRefs: string[];
};

/**
 * 위에서부터 먼저 걸리는 규칙이 이긴다. 한 공시가 여러 범주에 해당할 수 있는데
 * (예: "[기재정정]주요사항보고서(소송등의제기)"), 감사인에게 더 급한 신호를
 * 위에 둔다. 순서 자체가 판단이므로 함부로 재배열하지 말 것.
 */
const RULES: Rule[] = [
  {
    category: "부정혐의",
    severity: "high",
    // DART 정형 문구: "횡령ㆍ배임혐의발생", "횡령ㆍ배임사실확인"
    patterns: ["횡령", "배임"],
    reason:
      "횡령·배임 관련 공시입니다. 경영진의 통제 무력화 가능성을 전제로 부정위험을 재평가해야 합니다.",
    isaRefs: ["240"],
  },
  {
    category: "계속기업",
    severity: "high",
    patterns: [
      "회생절차",
      "파산",
      "부도",
      "당좌거래정지",
      "자본잠식",
      "관리종목",
      "상장폐지",
      "거래정지",
    ],
    reason:
      "계속기업 가정에 의문을 제기하는 사건입니다. 경영진의 존속능력 평가와 주석 공시를 확인해야 합니다.",
    isaRefs: ["570"],
  },
  {
    category: "감사보고",
    severity: "high",
    patterns: [
      "의견거절",
      "부적정의견",
      "한정의견",
      "회계처리기준위반",
      "감리결과",
      "증권선물위원회",
    ],
    reason:
      "감사의견이나 회계처리기준 위반과 직접 관련된 공시입니다. 전기 재무제표의 신뢰성과 감사의견 유형을 함께 검토해야 합니다.",
    // 비교표시 전기재무제표를 다루는 ISA 710은 이 도구의 화이트리스트에 없어
    // 인용하지 않는다. 실재하지 않는 번호를 화면에 띄우지 않는 것이 우선이다.
    isaRefs: ["705", "450"],
  },
  {
    category: "소송·분쟁",
    severity: "medium",
    patterns: ["소송", "분쟁", "가처분", "손해배상", "고소", "고발"],
    reason:
      "소송·클레임 관련 공시입니다. 우발부채 인식 여부와 주석 공시의 완전성을 확인해야 합니다.",
    isaRefs: ["501"],
  },
  {
    category: "특수관계자",
    severity: "medium",
    patterns: [
      "채무보증",
      "담보제공",
      "자금대여",
      "금전대여",
      "특수관계",
      "계열회사",
      "타법인주식및출자증권",
    ],
    reason:
      "특수관계자 거래일 가능성이 있는 공시입니다. 거래의 실재성과 주석 공시 여부를 확인해야 합니다.",
    isaRefs: ["550"],
  },
  {
    category: "지배구조",
    severity: "medium",
    patterns: [
      "최대주주변경",
      "합병",
      "분할",
      "영업양수",
      "영업양도",
      "주식교환",
      "주식이전",
      "감사인지정",
      "감사인변경",
    ],
    reason:
      "지배구조나 감사인이 바뀌는 사건입니다. 연결범위 변동과 기초잔액 확인 절차가 필요할 수 있습니다.",
    isaRefs: ["510", "550"],
  },
  {
    category: "자본거래",
    severity: "medium",
    patterns: [
      "유상증자",
      "무상증자",
      "전환사채",
      "신주인수권부사채",
      "교환사채",
      "자기주식",
      "감자",
    ],
    reason:
      "자본조달·자본감소 거래입니다. 자본 계정의 분류와 희석효과, 자금사용 목적을 확인해야 합니다.",
    isaRefs: ["540"],
  },
  {
    category: "정기공시",
    severity: "info",
    patterns: ["사업보고서", "반기보고서", "분기보고서", "감사보고서", "결산실적"],
    reason: "정기공시입니다. 재무제표 원문과 주석을 대조할 기준 문서입니다.",
    isaRefs: [],
  },
];

/** 제목 표기 흔들림(공백·중점·괄호)을 흡수한다. DART는 "횡령ㆍ배임"처럼 중점을 쓴다. */
function normalize(reportName: string): string {
  return String(reportName ?? "").replace(/[\s·ㆍ‧・.]/g, "");
}

/**
 * 정정공시인지 판정한다.
 *
 * DART는 정정 사실을 제목 앞 대괄호에 붙인다: "[기재정정]사업보고서 (2024.12)".
 * 이걸 놓치면 재무제표 정정이 평범한 사업보고서와 똑같이 한 줄로 묻힌다.
 */
function detectCorrection(normalized: string): {
  isCorrection: boolean;
  /** 재무정보 자체를 고친 정정인지. 첨부파일 교체와는 무게가 다르다. */
  touchesFinancials: boolean;
} {
  const isCorrection =
    /\[(기재정정|첨부정정|첨부추가|정정)\]/.test(normalized) ||
    normalized.includes("정정신고");
  if (!isCorrection) return { isCorrection: false, touchesFinancials: false };

  const financialTargets = [
    "사업보고서",
    "반기보고서",
    "분기보고서",
    "감사보고서",
    "재무제표",
    "결산실적",
    "매출액또는손익구조",
  ];
  return {
    isCorrection: true,
    touchesFinancials: financialTargets.some((t) => normalized.includes(t)),
  };
}

const OTHER_FLAG: DisclosureFlag = {
  category: "기타",
  severity: "info",
  reason: "분류 규칙에 해당하지 않는 공시입니다. 제목을 직접 확인하세요.",
  isaRefs: [],
};

/**
 * 공시 제목 하나를 분류한다. 순수함수 — 같은 제목이면 항상 같은 결과다.
 *
 * 정정 여부는 다른 범주와 배타적이지 않다. "[기재정정]주요사항보고서(소송등의제기)"는
 * 정정이면서 소송 건이다. 이때는 정정 쪽을 택하되(재무정보 정정이 더 급한 신호),
 * reason에 원래 범주를 함께 남겨 감사인이 놓치지 않게 한다.
 */
export function classifyDisclosure(reportName: string): DisclosureFlag {
  const normalized = normalize(reportName);
  const base = RULES.find((rule) =>
    rule.patterns.some((p) => normalized.includes(normalize(p)))
  );

  const { isCorrection, touchesFinancials } = detectCorrection(normalized);

  if (isCorrection) {
    // 재무정보를 고친 정정은 그 자체가 왜곡의 흔적이다. 무엇이 왜 틀렸는지,
    // 당기에도 같은 원인이 남아 있는지 확인해야 한다.
    const severity: DisclosureSeverity = touchesFinancials ? "high" : "medium";
    const carried =
      base && base.category !== "정기공시"
        ? ` 원 공시는 '${base.category}' 유형입니다.`
        : "";
    return {
      category: "정정공시",
      severity,
      reason: touchesFinancials
        ? `이미 공시한 재무정보를 정정한 건입니다. 정정 사유와 금액을 확인하고, 같은 원인이 당기에도 남아 있는지 검토해야 합니다.${carried}`
        : `기존 공시를 정정한 건입니다. 정정 대상이 재무정보인지 확인하세요.${carried}`,
      isaRefs: touchesFinancials ? ["240", "450"] : ["450"],
    };
  }

  return base
    ? {
        category: base.category,
        severity: base.severity,
        reason: base.reason,
        isaRefs: base.isaRefs,
      }
    : OTHER_FLAG;
}

/**
 * ISA 560의 후속사건은 결산일부터 **감사보고서일까지** 사이의 사건이다.
 * "결산일 이후 전부"가 아니다 — 그렇게 잡으면 결산 9개월 뒤 공시까지 후속사건
 * 후보가 되어 표시가 아무 정보도 주지 못한다(실제로 그렇게 만들었다가 삼성전자
 * 조회에서 10건 중 10건에 배지가 붙는 걸 보고 고쳤다).
 *
 * 감사보고서일은 알 수 없으므로, 자본시장법상 사업보고서 제출기한인 결산 후
 * 90일을 상한으로 쓴다. 실제 보고서일과 다를 수 있으나 무한정보다는 훨씬 낫다.
 */
export const SUBSEQUENT_EVENT_WINDOW_DAYS = 90;

/** "YYYY-MM-DD" 또는 "YYYYMMDD" → 8자리 숫자 문자열. 형식이 아니면 null. */
function toCompact(date: string): string | null {
  const digits = String(date ?? "").replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

function shiftDays(compact: string, days: number): string {
  const y = Number(compact.slice(0, 4));
  const m = Number(compact.slice(4, 6));
  const d = Number(compact.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return (
    `${dt.getUTCFullYear()}` +
    String(dt.getUTCMonth() + 1).padStart(2, "0") +
    String(dt.getUTCDate()).padStart(2, "0")
  );
}

/**
 * 결산일 이후 ~ 제출기한 사이에 접수된 공시인지 판정한다(ISA 560 후속사건 후보).
 *
 * receiptDate는 DART 형식 "YYYYMMDD", fiscalYearEnd는 "YYYY-MM-DD"를 받는다.
 * 형식이 어긋나면 판정하지 않고 false를 돌려준다 — 잘못된 구획으로 감사인을
 * 오도하느니 아무 표시도 안 하는 편이 낫다.
 */
export function isSubsequentEventCandidate(
  receiptDate: string,
  fiscalYearEnd: string
): boolean {
  const receipt = toCompact(receiptDate);
  const end = toCompact(fiscalYearEnd);
  if (!receipt || !end) return false;
  return receipt > end && receipt <= shiftDays(end, SUBSEQUENT_EVENT_WINDOW_DAYS);
}

/**
 * 감사 대상 사업연도에 맞는 공시 조회 창을 만든다.
 *
 * 사업연도 개시일부터 제출기한까지 — 즉 "감사 대상 기간 + 후속사건 기간"이다.
 * 오늘 기준 1년으로 조회하면 감사 대상 연도와 무관하게 창이 흘러가서, 오래된
 * 사업연도를 보는 순간 대상 기간이 통째로 빠진다.
 */
export function disclosureWindowForFiscalYear(fiscalYearEnd: string): {
  bgnDe: string;
  endDe: string;
} | null {
  const end = toCompact(fiscalYearEnd);
  if (!end) return null;
  // 사업연도 개시일 = 1년 전 같은 날의 다음 날. 일수(-364)로 빼면 윤년에 하루
  // 어긋나 연초 공시 한 건이 조용히 빠진다. 12월 결산이 아니어도 맞는다.
  const priorYearEnd =
    String(Number(end.slice(0, 4)) - 1) + end.slice(4);
  return {
    bgnDe: shiftDays(priorYearEnd, 1),
    endDe: shiftDays(end, SUBSEQUENT_EVENT_WINDOW_DAYS),
  };
}

export type DisclosureInput = {
  reportName: string;
  receiptDate: string;
  receiptNo: string;
};

export type ClassifiedDisclosure = DisclosureInput & {
  flag: DisclosureFlag;
  /** 결산일 이후 접수 = ISA 560 후속사건 검토 후보. */
  isSubsequentEvent: boolean;
};

export type DisclosureAnalysis = {
  items: ClassifiedDisclosure[];
  /** severity별 건수. 화면 상단 요약과 조서 문구에 함께 쓴다. */
  counts: Record<DisclosureSeverity, number>;
  /** 주의가 필요한 건수(high + medium). */
  attentionCount: number;
  subsequentEventCount: number;
  /** 후속사건 판정에 쓴 기준일. 판정하지 않았으면 null. */
  fiscalYearEnd: string | null;
};

/**
 * 공시 목록 전체를 분류하고 집계한다.
 *
 * 정렬은 하지 않는다. DART가 최신순으로 주는 순서가 감사인이 훑는 순서와
 * 같고, 위험도순으로 재정렬하면 "언제 무슨 일이 있었나"라는 시간 흐름이
 * 깨진다. 강조는 화면에서 색으로 한다.
 */
export function analyzeDisclosures(
  disclosures: DisclosureInput[],
  fiscalYearEnd?: string | null
): DisclosureAnalysis {
  const end = fiscalYearEnd ?? null;
  const items = (disclosures ?? []).map((d) => ({
    ...d,
    flag: classifyDisclosure(d.reportName),
    isSubsequentEvent: end
      ? isSubsequentEventCandidate(d.receiptDate, end)
      : false,
  }));

  const counts: Record<DisclosureSeverity, number> = {
    high: 0,
    medium: 0,
    info: 0,
  };
  for (const item of items) counts[item.flag.severity] += 1;

  return {
    items,
    counts,
    attentionCount: counts.high + counts.medium,
    subsequentEventCount: items.filter((i) => i.isSubsequentEvent).length,
    fiscalYearEnd: end,
  };
}

/** 사업연도로부터 결산일을 만든다. 결산월 정보가 없어 12월 결산을 가정한다. */
export function fiscalYearEndFromYear(year: string | undefined): string | null {
  const y = String(year ?? "").match(/^\d{4}$/);
  return y ? `${y[0]}-12-31` : null;
}
