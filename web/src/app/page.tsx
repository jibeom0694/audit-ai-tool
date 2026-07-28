"use client";

import { useEffect, useRef, useState } from "react";

// 표준 TypeScript DOM 라이브에는 Web Speech API 타입이 없어(webkitSpeechRecognition은
// 비표준 접두사 API) 최소한의 형태만 직접 선언한다.
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult:
    | ((event: {
        results: { [index: number]: { [index: number]: { transcript: string } } };
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}
import {
  parseFinancialTemplate,
  type JournalRow,
  type ParsedFinancials,
} from "@/lib/excelParse";
import {
  SAMPLE_COMPANY_NAME,
  SAMPLE_EXCEL_PARSED,
  SAMPLE_JOURNAL_ROWS,
  SAMPLE_TRIAL_BALANCE,
} from "@/lib/sampleData";
import type { NormalizedFinancials, StatementRow } from "@/lib/financials";
import { findAccountValue } from "@/lib/financials";
import {
  calculateAccountChanges,
  calculateRatios,
  calculateValuationRatios,
  crossCheckAccounts,
  type AccountChange,
  type CrossCheckFlag,
  type Ratio,
} from "@/lib/ratios";
import {
  calculateAltmanZScore,
  calculateBeneishMScore,
  detectRoundTripTransactions,
  runBenfordTest,
  runRsfTest,
  type AltmanResult,
  type BeneishResult,
  type BenfordResult,
  type RoundTripFlag,
  type RsfFlag,
} from "@/lib/anomalyDetection";
import {
  calculateMusSampleSize,
  isMusEligibleAccount,
  type MusConfidenceLevel,
} from "@/lib/musSampling";
import { runJournalEntryTests } from "@/lib/journalTests";
import {
  BENCHMARKS,
  PM_RATES,
  CTT_RATE,
  calculateMateriality,
  readBenchmarkAmount,
  type BenchmarkKey,
  type RiskLevel,
} from "@/lib/materiality";
import {
  MISSTATEMENT_TYPE_LABELS,
  summarizeMisstatements,
  type Misstatement,
  type MisstatementType,
} from "@/lib/misstatements";
import StandardsChat from "@/components/StandardsChat";
import IsaStandardModal from "@/components/IsaStandardModal";
import LoadingDots from "@/components/LoadingDots";
import {
  getSessionId,
  fetchServerRequests,
  createServerRequest,
  deleteServerRequest,
  appendServerEvent,
  fetchServerEvents,
  type ServerAuditEvent,
} from "@/lib/auditClient";
import {
  formatIsaReferenceKo,
  resolveIsaReference,
} from "@/lib/isaStandards";
import {
  checkTrialBalance,
  downloadTrialBalanceTemplate,
  parseTrialBalance,
  type TrialBalanceRow,
} from "@/lib/trialBalance";
import {
  exportAuditReportPdf,
  exportAuditReportWord,
  type AuditReportData,
} from "@/lib/reportExport";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type AnalysisRequest = {
  id: string;
  companyName: string;
  source: "dart" | "excel" | "upstage";
  corpCode?: string;
  stockCode?: string;
  excelSummary?: string;
  financials?: NormalizedFinancials;
  journalRows?: JournalRow[];
  trialBalanceRows?: TrialBalanceRow[];
  createdAt: string;
};

type CorpSearchResult = {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  modify_date: string;
};

type FinancialHighlights = {
  company_name?: string;
  자산총계_당기?: number;
  자산총계_전기?: number;
  부채총계_당기?: number;
  부채총계_전기?: number;
  자본총계_당기?: number;
  자본총계_전기?: number;
  매출액_당기?: number;
  매출액_전기?: number;
  매출원가_당기?: number;
  매출원가_전기?: number;
  판매비와관리비_당기?: number;
  판매비와관리비_전기?: number;
  영업이익_당기?: number;
  영업이익_전기?: number;
  영업외수익_당기?: number;
  영업외수익_전기?: number;
  영업외비용_당기?: number;
  영업외비용_전기?: number;
  법인세비용_당기?: number;
  법인세비용_전기?: number;
  당기순이익_당기?: number;
  당기순이익_전기?: number;
};

type AmountKey = Exclude<keyof FinancialHighlights, "company_name">;

const STORAGE_KEY = "audit-ai-demo-requests";
const MISMATCH_TOLERANCE = 1;

// ── 기밀성(제3자 AI 전송) 동의 게이트 ──
// 재무제표 이미지/PDF 자동인식(Upstage)·AI 체크리스트·공시요약은 입력/파생
// 데이터를 외부 AI 서비스(Upstage)로 전송한다. 공인회계사의 비밀유지의무상,
// 실제 고객의 기밀 데이터가 계약(DPA) 없이 외부로 나가면 안 되므로, 이 기능들을
// 처음 쓸 때 한 번 명시적으로 동의를 받고 그 사실을 기록한다.
const AI_CONSENT_KEY = "audit-ai-thirdparty-consent";
const AI_CONSENT_MESSAGE =
  "이 기능은 입력·파생 데이터를 외부 AI 서비스(Upstage)로 전송합니다.\n\n" +
  "· 재무제표 이미지/PDF 자동인식: 업로드한 파일이 Upstage로 전송됩니다.\n" +
  "· AI 체크리스트: 감지된 위험 신호(계정·거래처 등 포함)가 Upstage Solar로 전송됩니다.\n" +
  "· AI 공시요약: DART 공개 공시 제목이 Upstage Solar로 전송됩니다.\n\n" +
  "공인회계사의 비밀유지의무상, 별도의 데이터처리계약(DPA) 없이 실제 고객의 기밀 정보를 전송하지 마세요. " +
  "테스트용·공개(상장) 데이터로만 사용하는 것을 권장합니다.\n\n" +
  "위 내용에 동의하고 계속하시겠습니까? (이 선택은 이 브라우저에 한 번만 저장됩니다)";

/** 제3자 AI 전송 기능 실행 전에 1회 동의를 확인한다. 미동의 시 false를 반환하고
 * 호출부는 전송을 중단해야 한다. */
function ensureThirdPartyAiConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(AI_CONSENT_KEY) === "granted") return true;
  } catch {
    // 로컬스토리지 접근 불가 환경 — 매번 확인
  }
  const ok = window.confirm(AI_CONSENT_MESSAGE);
  if (ok) {
    try {
      window.localStorage.setItem(AI_CONSENT_KEY, "granted");
    } catch {
      // 저장 실패해도 이번 동의는 유효
    }
  }
  return ok;
}

const REPRT_CODE_LABELS: Record<string, string> = {
  "11011": "사업보고서",
  "11012": "반기보고서",
  "11014": "3분기보고서",
  "11013": "1분기보고서",
};

const FS_DIV_LABELS: Record<string, string> = {
  OFS: "개별재무제표",
  CFS: "연결재무제표",
};

function formatAmount(value?: number) {
  return value != null ? value.toLocaleString() : "-";
}

/**
 * 손익계산서 산식(매출액-매출원가-판관비=영업이익, 영업이익+영업외수익-영업외비용
 * -법인세비용=당기순이익)으로 영업이익/당기순이익을 재계산해 AI가 인식한 값과
 * 어긋나는지 교차검증한다. 계산에 필요한 입력값이 하나라도 없으면 검증하지 않는다.
 */
function checkIncomeStatement(h: FinancialHighlights, period: "당기" | "전기") {
  const revenue = h[`매출액_${period}`];
  const cogs = h[`매출원가_${period}`];
  const sga = h[`판매비와관리비_${period}`];
  const operatingIncome = h[`영업이익_${period}`];
  const nonOpIncome = h[`영업외수익_${period}`];
  const nonOpExpense = h[`영업외비용_${period}`];
  const tax = h[`법인세비용_${period}`];
  const netIncome = h[`당기순이익_${period}`];

  let computedOperatingIncome: number | undefined;
  if (revenue != null && cogs != null && sga != null) {
    computedOperatingIncome = revenue - cogs - sga;
  }

  let computedNetIncome: number | undefined;
  const opIncomeForNet = computedOperatingIncome ?? operatingIncome;
  if (opIncomeForNet != null && nonOpIncome != null && nonOpExpense != null && tax != null) {
    computedNetIncome = opIncomeForNet + nonOpIncome - nonOpExpense - tax;
  }

  const operatingIncomeMismatch =
    computedOperatingIncome != null &&
    operatingIncome != null &&
    Math.abs(computedOperatingIncome - operatingIncome) > MISMATCH_TOLERANCE;

  const netIncomeMismatch =
    computedNetIncome != null &&
    netIncome != null &&
    Math.abs(computedNetIncome - netIncome) > MISMATCH_TOLERANCE;

  return {
    computedOperatingIncome,
    computedNetIncome,
    operatingIncomeMismatch,
    netIncomeMismatch,
  };
}

const FEATURES = [
  {
    title: "재무비율 계산 및 분석",
    desc: "유동성·수익성·성장성 비율을 자동 계산하고, 전기 대비 이상 변동 계정을 하이라이트합니다.",
  },
  {
    title: "이상탐지 모델",
    desc: "Benford's Law, Beneish M-Score, Altman Z-Score, RSF 테스트, 라운드트립(2자간 상계성 거래) 탐지로 부정거래 가능성을 스크리닝합니다.",
  },
  {
    title: "감사 체크리스트 자동생성",
    desc: "위험요소를 분석하고 그 결과를 바탕으로 수행할 수 있는 감사절차를 자동으로 매칭해줍니다.",
  },
  {
    title: "MUS 샘플링 계산기",
    desc: "신뢰수준·허용왜곡·예상오류율을 입력하면 실사 시 통계적으로 타당한 표본크기를 산출합니다.",
  },
  {
    title: "AI 공시요약",
    desc: "DART 주요 공시를 3줄로 요약하고 감사 시 쟁점이 될 포인트를 제안합니다.",
  },
  {
    title: "대시보드 & 리포트",
    desc: "분석 결과를 시각화하고, 조서번호·중요성·사인란·결론을 갖춘 분석적검토 조서(초안)로 export할 수 있습니다.",
  },
];

type RatioExplain = {
  label: string;
  formula: string;
  meaning: string;
};

type RatioCategoryExplain = {
  category: string;
  description: string;
  ratios: RatioExplain[];
};

/** "핵심 기능" 카드를 클릭했을 때 뜨는 상세 설명. 기능별로 이 형태의 데이터를
 * 채워 넣으면 FeatureDetail 컴포넌트가 동일한 레이아웃으로 렌더링한다. */
const FEATURE_DETAILS: Record<
  string,
  { intro: string; categories: RatioCategoryExplain[] }
> = {
  "재무비율 계산 및 분석": {
    intro:
      "재무제표의 각 계정을 조합해 유동성·수익성·성장성·안정성·가치평가 5개 영역의 비율을 자동으로 계산합니다. 각 비율은 특정 질문에 답하기 위한 것으로, 숫자 하나만 보기보다는 여러 비율을 함께 보고 전기 대비 변화, 동종업계 평균과 비교해 해석해야 합니다. 회계감사 관점에서는 이러한 비율분석이 ISA 520(분석적 절차)의 핵심 도구로 쓰이며, 예상과 다른 비율 변동은 추가 감사절차가 필요한 위험신호로 이어집니다.",
    categories: [
      {
        category: "유동성 비율 — 단기 채무상환능력",
        description:
          "1년 내 갚아야 할 부채를, 1년 내 현금화 가능한 자산으로 얼마나 감당할 수 있는지를 보여줍니다. 계속기업 가정(ISA 570)을 평가할 때 가장 먼저 보는 지표군입니다.",
        ratios: [
          {
            label: "유동비율(Current Ratio)",
            formula: "유동자산 ÷ 유동부채 × 100",
            meaning:
              "통상 100% 이상이면 단기지급능력이 있다고 보고, 업종마다 다르지만 150~200% 수준을 안정적으로 평가합니다. 너무 낮으면 유동성 위기 신호이고, 반대로 지나치게 높으면 현금·재고 등 자산을 비효율적으로 쌓아두고 있다는 뜻일 수 있습니다.",
          },
          {
            label: "당좌비율(Quick Ratio)",
            formula: "(유동자산 − 재고자산) ÷ 유동부채 × 100",
            meaning:
              "재고자산은 현금화까지 시간이 걸리고 가격 하락·진부화 위험이 있어 제외한, 더 보수적인 단기지급능력 지표입니다. 100% 이상이면 우량하다고 보며, 유동비율과 차이가 크게 벌어질수록 재고자산 비중이 과도하다는 신호입니다.",
          },
        ],
      },
      {
        category: "수익성 비율 — 이익창출능력",
        description:
          "매출에서 시작해 매출원가, 판관비, 영업외손익, 세금을 순서대로 제외해 가면서 '어느 단계에서' 수익성이 좋아지거나 나빠지는지 단계별로 보여줍니다.",
        ratios: [
          {
            label: "매출총이익률(Gross Profit Margin)",
            formula: "매출총이익 ÷ 매출액 × 100",
            meaning:
              "매출원가를 제외하고 남는 이익의 비율로, 제품·서비스의 가격결정력과 원가통제력을 나타냅니다.",
          },
          {
            label: "영업이익률(Operating Margin)",
            formula: "영업이익 ÷ 매출액 × 100",
            meaning:
              "판매비와관리비까지 반영한 '본업'의 수익성입니다. 일회성 영업외손익의 영향을 받지 않아 핵심 사업 경쟁력을 가장 잘 보여주는 지표로 꼽힙니다.",
          },
          {
            label: "순이익률(Net Profit Margin)",
            formula: "당기순이익 ÷ 매출액 × 100",
            meaning:
              "영업외손익과 법인세까지 모두 반영한 최종 수익성입니다. 자산처분이익 등 일회성 손익에 의해 왜곡될 수 있어 영업이익률과 함께 비교해서 봐야 합니다.",
          },
          {
            label: "총자산순이익률(ROA)",
            formula: "당기순이익 ÷ 자산총계 × 100",
            meaning:
              "부채로 조달한 자산까지 포함해, 회사가 보유한 전체 자산을 얼마나 효율적으로 활용해 이익을 냈는지 보여줍니다.",
          },
          {
            label: "자기자본순이익률(ROE)",
            formula: "당기순이익 ÷ 자본총계 × 100",
            meaning:
              "주주가 투자한 돈(자기자본) 대비 수익률로, 투자자 관점에서 가장 널리 쓰이는 지표입니다. 부채를 늘리면 ROE가 인위적으로 높아질 수 있어 부채비율과 함께 해석해야 합니다.",
          },
        ],
      },
      {
        category: "성장성 비율 — 전기 대비 변화 속도",
        description:
          "전기 대비 얼마나 빠르게 성장(또는 역성장)하고 있는지를 보여줍니다. 감사 관점에서는 성장 속도 자체보다, 계정 간 성장 속도의 '불균형'이 더 중요한 위험신호입니다.",
        ratios: [
          {
            label: "매출액증가율",
            formula: "(매출액_당기 − 매출액_전기) ÷ |매출액_전기| × 100",
            meaning:
              "매출 규모가 전기 대비 얼마나 늘었는지 보여줍니다. 매출채권·재고자산 증가율이 매출액증가율보다 비정상적으로 높다면 가공매출이나 재고 과다계상 가능성을 의심할 신호가 됩니다(본 도구의 '교차검증 위험 신호'와 연결).",
          },
          {
            label: "총자산증가율",
            formula: "(자산총계_당기 − 자산총계_전기) ÷ |자산총계_전기| × 100",
            meaning: "회사 규모(자산) 자체가 얼마나 빠르게 커지고 있는지 보여줍니다.",
          },
          {
            label: "순이익증가율",
            formula: "(당기순이익_당기 − 당기순이익_전기) ÷ |당기순이익_전기| × 100",
            meaning:
              "이익 성장 속도이며, 매출액증가율과 큰 차이가 나면(예: 매출은 그대로인데 순이익만 급증) 일회성 손익이나 비용 조작 가능성을 점검할 필요가 있습니다.",
          },
        ],
      },
      {
        category: "안정성 비율 — 재무구조 건전성",
        description:
          "자기자본 대비 부채 의존도와, 영업으로 번 돈으로 이자를 감당할 수 있는지를 보여줍니다. 계속기업 가정(ISA 570)을 판단할 때 핵심적으로 검토하는 영역입니다.",
        ratios: [
          {
            label: "부채비율(Debt Ratio)",
            formula: "부채총계 ÷ 자본총계 × 100",
            meaning:
              "자기자본 대비 타인자본(부채) 의존도입니다. 100% 이하면 안정적, 200%를 넘으면 재무위험이 높다고 보는 것이 일반적이나 업종별 편차가 큽니다.",
          },
          {
            label: "이자보상배율(Interest Coverage Ratio)",
            formula: "영업이익 ÷ 이자비용",
            meaning:
              "영업이익으로 이자비용을 몇 배 감당할 수 있는지 보여줍니다. 1배 미만이면 본업에서 번 돈으로 이자도 못 갚는다는 뜻이며, 계속기업 가정에 대한 감사 시 핵심 점검 포인트입니다.",
          },
        ],
      },
      {
        category: "가치평가 지표 — 주당 가치 (상장기업 중심)",
        description:
          "주식 1주를 기준으로 이익·순자산·주가 수준을 비교하는 지표입니다. 시가(주가)가 필요한 PER·PBR은 사용자가 직접 주가를 입력해야 계산되며, 발행주식수를 별도로 공시하지 않는 DART 재무제표 특성상 BPS는 EPS와 당기순이익으로 발행주식수를 역산한 근사치입니다.",
        ratios: [
          {
            label: "주당순이익(EPS)",
            formula: "당기순이익 ÷ 발행주식수(DART 공시값)",
            meaning: "주식 1주가 벌어들인 순이익입니다.",
          },
          {
            label: "주당순자산(BPS)",
            formula: "자본총계 ÷ 추정 발행주식수(당기순이익 ÷ EPS)",
            meaning: "주식 1주가 보유한 순자산가치로, 회사 청산가치의 근사치로도 쓰입니다.",
          },
          {
            label: "주가수익비율(PER)",
            formula: "입력한 주가 ÷ EPS",
            meaning:
              "이익 대비 주가가 몇 배로 거래되는지를 보여줍니다. 낮을수록 이익 대비 저평가, 높을수록 성장 기대가 반영된 고평가로 해석하는 것이 일반적입니다.",
          },
          {
            label: "주가순자산비율(PBR)",
            formula: "입력한 주가 ÷ BPS",
            meaning:
              "순자산 대비 주가가 몇 배인지 보여줍니다. 1배 미만이면 장부상 순자산가치보다 낮은 가격에 거래되고 있다는 뜻입니다.",
          },
        ],
      },
    ],
  },
  "이상탐지 모델": {
    intro:
      "단순 재무비율 분석만으로는 잡아내기 어려운 이상거래·분식회계 징후를, 통계·수학 모델로 스크리닝합니다. 아래 5가지 기법은 숫자 분포, 재무비율 조합, 거래 구조라는 서로 다른 각도에서 이상 징후를 찾기 때문에, 하나의 기법에 의존하기보다 여러 기법의 결과를 함께 보는 것이 안전합니다. 회계감사 관점에서는 ISA 240(부정)에 따른 부정위험 대응 절차의 스크리닝 도구로 활용됩니다.",
    categories: [
      {
        category: "Benford's Law — 벤포드 법칙",
        description:
          "자연 발생 데이터의 숫자 앞자리는 무작위가 아니라 특정 확률분포를 따른다는 통계 법칙입니다. 사람이 숫자를 지어내거나 조작하면 이 분포에서 벗어나는 경향이 있어, 대량의 거래 데이터에서 조작 가능성이 있는 항목을 1차로 걸러내는 데 씁니다.",
        ratios: [
          {
            label: "제1자리 숫자 검정(First-digit test)",
            formula: "P(d) = log₁₀(1 + 1/d), d = 1~9",
            meaning:
              "거래금액의 맨 앞자리 숫자 분포를 이 이론값과 비교합니다. 예를 들어 1로 시작하는 금액은 이론상 약 30.1%가 나와야 하는데, 실제 전표 데이터에서 특정 숫자가 부자연스럽게 몰려 있다면 인위적으로 만든 숫자일 가능성을 의심합니다. 표본(전표) 수가 많을수록 정확도가 높아집니다.",
          },
        ],
      },
      {
        category: "Beneish M-Score — 베니시 M-스코어",
        description:
          "8개의 재무비율을 가중합산해 '이익조작 가능성 점수'를 산출하는 모델입니다. 미국 학자 Messod Beneish가 실제 분식회계 사례들을 통계 분석해 만들었습니다.",
        ratios: [
          {
            label: "M-Score",
            formula:
              "M = −4.84 + 0.92·DSRI + 0.528·GMI + 0.404·AQI + 0.892·SGI + 0.115·DEPI − 0.172·SGAI + 4.679·TATA − 0.327·LVGI",
            meaning:
              "DSRI(매출채권지수)·GMI(매출총이익률지수)·AQI(자산품질지수)·SGI(매출성장지수)·DEPI(감가상각지수)·SGAI(판관비지수)·LVGI(레버리지지수)·TATA(총발생액지수) 8개 지수로 구성됩니다. 계산된 M-Score가 약 −1.78보다 크면(0에 가깝거나 양수) 이익조작 가능성이 높은 것으로 해석하며, 매출채권 급증·성장성 이상처럼 흩어져 있던 신호를 하나의 점수로 종합해서 보여줍니다.",
          },
        ],
      },
      {
        category: "Altman Z-Score — 알트만 Z-스코어",
        description:
          "5개 재무비율을 가중합산해 '부도(파산) 가능성'을 예측하는 모델입니다. 계속기업 가정을 감사할 때 정량적 근거로 널리 활용됩니다.",
        ratios: [
          {
            label: "Z-Score",
            formula: "Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5",
            meaning:
              "X1=운전자본/자산총계, X2=이익잉여금/자산총계, X3=영업이익/자산총계, X4=자기자본/부채총계, X5=매출액/자산총계입니다. Z>2.99면 안전지대, 1.81~2.99는 회색지대(주의 필요), 1.81 미만이면 위험지대로 분류해 계속기업 가정(ISA 570)에 의문을 제기할 정량적 근거로 씁니다.",
          },
        ],
      },
      {
        category: "RSF 테스트 — 상대크기요인 테스트",
        description:
          "같은 계정·거래처 안에서 '가장 큰 금액'이 '두 번째로 큰 금액'에 비해 비정상적으로 크지 않은지 확인하는 검정입니다. Benford's Law가 전체 데이터의 분포를 보는 것과 달리, 개별 계정·거래처 단위의 이상치를 잡아냅니다.",
        ratios: [
          {
            label: "RSF(Relative Size Factor)",
            formula: "RSF = 최대 금액 ÷ 두 번째로 큰 금액 (동일 계정·거래처 내)",
            meaning:
              "이 비율이 비정상적으로 크면, 평소 거래 규모에 비해 유독 튀는 금액 하나가 섞여 있다는 뜻입니다. 단순 오류일 수도 있지만, 가공 거래나 입력 실수를 걸러내는 1차 스크리닝 도구로 씁니다.",
          },
        ],
      },
      {
        category: "라운드트립(2자간 상계성 거래) 탐지",
        description:
          "같은 거래처에 대해 '매출(팔았다)'과 '매입·자산취득(샀다)'이 짧은 기간 안에 비슷한 금액으로 함께 잡히는지 찾습니다. 실질적인 경제적 효과 없이 매출과 매입을 서로 태워 상계시키는 라운드트립(round-trip) 의심 패턴을 걸러내는 2차 스크리닝입니다.",
        ratios: [
          {
            label: "2자간 매출↔매입 매칭",
            formula:
              "동일 거래처 · 매출(수익 계정 대변)과 매입(매입·자산·용역 계정 차변)의 금액 차이 ≤5% · 전기일자 간격 ≤30일 · 매출 1건은 매입 1건에만 1:1 매칭",
            meaning:
              "예를 들어 우리가 X사에 5,000만원을 팔고 며칠 뒤 X사로부터 5,000만원어치를 되사면, 실질 없이 장부상 매출만 부풀린 것일 수 있습니다. 거래 방향은 전표 차/대변 부호가 아니라 계정과목의 성격(매출인지·매입인지)으로 판정하므로, 매출채권 회수나 매입채무 지급 같은 정상적인 채권·채무 결제는 오탐으로 잡히지 않습니다.",
          },
          {
            label: "범위 한정(단일 회사 전표)",
            formula: "다자간 순환(A→B→C→A)은 대상 아님",
            meaning:
              "여러 회사를 거쳐 자금이 한 바퀴 돌아오는 다자간 순환거래는 한 회사의 전표만으로는 관측할 수 없어, 이 도구는 '거래처↔당사' 2자간 라운드트립으로 범위를 한정합니다. 특수관계자 다자간 순환은 각 사 전표를 함께 확보해 별도로 확인해야 합니다.",
          },
        ],
      },
    ],
  },
  "감사 체크리스트 자동생성": {
    intro:
      "재무비율 계산 및 분석과 이상탐지 모델에서 이미 계산·표시된 위험 신호를 그대로 모아, Upstage Solar LLM(채팅 완성 API)에게 각 신호마다 대응하는 감사절차를 국제감사기준(ISA) 근거와 함께 제안하도록 합니다. 새로운 값을 따로 계산하지 않고 화면에 표시된 '이상' 판정만 재사용하기 때문에, 감사인이 이미 확인한 위험 신호와 체크리스트가 서로 어긋나지 않습니다.",
    categories: [
      {
        category: "① 위험 신호 수집 — 어디서 데이터를 가져오는가",
        description:
          "체크리스트를 만들기 전, 이 화면에 이미 계산되어 있는 결과 중 '이상'으로 판정된 항목만 골라 위험 신호 목록을 만듭니다. 정상 범위인 항목은 애초에 목록에 들어가지 않습니다.",
        ratios: [
          {
            label: "재무비율 임계치 이탈",
            formula: "유동비율<100% · 부채비율>200% · 이자보상배율<1배 · 영업이익률/순이익률/ROE<0%",
            meaning:
              "재무비율 계산 및 분석에 표시된 값 중 통상적으로 위험 신호로 보는 기준을 벗어나는 것만 자동으로 뽑아 포함합니다.",
          },
          {
            label: "전기 대비 이상 변동 · 교차검증",
            formula: "증감률 20%·중요성 금액 동시 충족 계정, 매출채권·재고자산 vs 매출 증가율 괴리",
            meaning:
              "재무비율 화면의 '전기 대비 이상 변동 계정'과 '교차검증 위험 신호'에 이미 하이라이트된 항목을 그대로 가져옵니다.",
          },
          {
            label: "이상탐지 모델 판정",
            formula: "Beneish M-Score>−1.78 · Altman Z′-Score<2.9 · Benford 카이제곱>15.51 · RSF≥3배 · 라운드트립 탐지",
            meaning:
              "이상탐지 모델 5종 중 '이상' 또는 '주의'로 판정된 결과만 포함됩니다 — 예를 들어 Altman Z′-Score가 안전지대면 체크리스트에 등장하지 않습니다.",
          },
        ],
      },
      {
        category: "② 체크리스트 생성 — Upstage Solar LLM",
        description:
          "모은 위험 신호를 텍스트로 정리해 Solar LLM에 전달합니다. 프롬프트에서 입력된 신호 개수만큼만, 그 신호에만 근거해 답하도록 명시적으로 제한해 목록에 없는 계정이나 사건을 지어내지 않도록 설계했습니다.",
        ratios: [
          {
            label: "출력 형식",
            formula: "{risk, procedure, isaReference} 객체 배열 (JSON Schema로 강제)",
            meaning:
              "위험요소를 한 문장으로 요약한 risk, 실제로 수행할 수 있는 구체적인 감사절차인 procedure, 근거가 되는 ISA 기준 번호·명칭인 isaReference로 구성된 항목을 신호마다 하나씩 생성합니다.",
          },
        ],
      },
      {
        category: "③ 한계와 주의사항",
        description:
          "이 체크리스트는 감사인의 최종 판단을 대신하지 않는 AI 초안입니다.",
        ratios: [
          {
            label: "AI 생성 결과의 한계",
            formula: "화면에 \"AI가 생성한 초안이며 최종 판단은 감사인이 직접 내려야 합니다\" 고지",
            meaning:
              "LLM은 입력된 위험 신호를 그럴듯하게 설명하지만, 실제 회사 상황(업종 특성, 계약 내용 등)을 모르는 상태에서 만든 일반적인 절차 제안입니다. 감사인이 실제 문서·거래처 확인 등을 통해 검증해야 합니다.",
          },
        ],
      },
    ],
  },
  "MUS 샘플링 계산기": {
    intro:
      "화폐단위표본추출(MUS, Monetary Unit Sampling)은 모집단을 '항목' 단위가 아니라 '금액(원)' 단위로 취급해, 금액이 큰 항목일수록 표본에 뽑힐 확률이 자연스럽게 높아지는 표본추출 기법입니다. 실사·채권조회 등 잔액 실증절차에서 통계적으로 타당한 표본크기를 산출하는 데 널리 쓰이며, 경험적 추정이 아닌 산식에 근거하므로 감사조서에 표본설계의 타당성을 문서화하기 좋습니다. ISA 530(감사표본)의 표본설계·표본크기 결정 절차를 다룹니다.",
    categories: [
      {
        category: "① 입력값 — 표본크기를 결정하는 4가지 변수",
        description:
          "신뢰수준을 높게 잡거나 허용왜곡금액을 작게 잡을수록 더 많은 표본이 필요합니다. 반대로 예상오류율이 낮을수록(오류가 거의 없을 것으로 예상할수록) 필요한 표본은 줄어듭니다.",
        ratios: [
          {
            label: "신뢰수준(Confidence Level)",
            formula: "90% · 95% · 99% 중 선택",
            meaning:
              "표본 결과로 모집단 전체에 대해 내린 결론이 맞을 확률입니다. 높일수록(예: 99%) 더 안전하지만 표본크기가 커집니다.",
          },
          {
            label: "허용왜곡금액(Tolerable Misstatement)",
            formula: "통상 수행중요성(Performance Materiality) 금액을 사용",
            meaning:
              "이 계정에서 발생해도 재무제표 전체에 중요한 영향을 주지 않는다고 보는 최대 왜곡 금액입니다. 작을수록 더 정밀하게 봐야 하므로 표본크기가 커집니다.",
          },
          {
            label: "예상오류율(Expected Misstatement Rate)",
            formula: "모집단 총액에 대한 비율(%)",
            meaning:
              "이미 어느 정도 오류가 있을 것으로 예상되면, 그 오류를 표본 결과에서 구분해내기 위해 표본을 더 늘려야 합니다. 오류가 거의 없을 것으로 예상되면 0에 가깝게 입력합니다.",
          },
          {
            label: "모집단 총액(Population Amount)",
            formula: "표본을 추출할 계정·거래의 장부금액 합계",
            meaning:
              "매출채권 총액, 재고자산 총액처럼 실증절차 대상이 되는 계정의 전체 장부금액입니다.",
          },
        ],
      },
      {
        category: "② 계산 방법 — 신뢰요소와 확장계수",
        description:
          "표본크기는 신뢰요소를 모집단에 곱하고, 예상오류를 반영해 조정한 허용왜곡금액으로 나누어 구합니다. 신뢰요소·확장계수는 감사표본 문헌에서 널리 쓰이는 포아송 분포 기반 표(0건 오류 기준)를 사용합니다.",
        ratios: [
          {
            label: "표본크기 산식",
            formula:
              "표본크기 = (신뢰요소 × 모집단 총액) ÷ (허용왜곡금액 − 예상오류금액 × 확장계수)",
            meaning:
              "신뢰요소는 90%=2.31, 95%=3.00, 99%=4.61이며, 확장계수는 90%=1.5, 95%=1.6, 99%=2.0을 사용합니다. 예상오류금액 = 모집단 총액 × 예상오류율입니다.",
          },
          {
            label: "표본추출 간격(Sampling Interval)",
            formula: "모집단 총액 ÷ 표본크기",
            meaning:
              "계통추출(Systematic Selection) 시 이 금액 간격마다 하나씩 항목을 뽑습니다. 예를 들어 간격이 1억원이면, 누적금액 0~1억, 1억~2억 구간마다 그 구간에 걸리는 거래 1건씩을 표본으로 선택합니다.",
          },
        ],
      },
      {
        category: "③ 한계와 주의사항",
        description:
          "이 계산기는 표본'크기'와 표본추출 '위치(누적금액 태그)'만 산출합니다. 실제 표본항목을 확정하려면 추가 작업이 필요합니다.",
        ratios: [
          {
            label: "실제 거래 매핑 필요",
            formula: "누적금액 태그 → 모집단 거래 목록의 누적금액 구간 매칭",
            meaning:
              "이 도구는 특정 회사의 실제 거래 목록(전표데이터)까지 연결하지는 않으므로, 산출된 누적금액 태그가 실제로 어떤 거래에 해당하는지는 감사인이 모집단 원장과 대조해 확인해야 합니다.",
          },
          {
            label: "0건 오류 가정의 한계",
            formula: "신뢰요소는 '표본에서 오류가 0건 발견'을 가정한 값",
            meaning:
              "표본검사 중 실제 오류가 발견되면 이 신뢰요소로는 부족하며, 추가 표본 확대나 다른 평가 방법(오류율 투영 등)이 필요합니다. 이 계산기는 사전 표본설계 단계에만 사용합니다.",
          },
        ],
      },
    ],
  },
  "AI 공시요약": {
    intro:
      "상장기업은 최근 1년간 수십~수백 건의 공시를 냅니다. 감사인이 이 제목을 전부 훑어보며 감사와 관련된 쟁점을 골라내는 데는 시간이 걸리는데, DART 공시 목록을 최신순으로 불러와 Upstage Solar LLM에게 제목만으로 감사상 쟁점이 될 만한 공시를 1차로 스크리닝시켜 검토 우선순위를 빠르게 잡도록 돕습니다. ISA 560(후속사건)·ISA 550(특수관계자)처럼 특정 사건·거래 유형을 놓치지 않았는지 확인하는 보조 도구입니다.",
    categories: [
      {
        category: "① 공시 목록 조회 — DART list.json",
        description:
          "선택한 회사의 고유번호(corp_code)로 DART 공시검색 API를 호출해, 최근 1년간의 공시를 최신순으로 최대 10건 가져옵니다. 전체 공시가 아니라 최근 일정 기간만 보는 이유는, 감사 시점 기준으로 가장 최근에 있었던 사건을 우선 확인하기 위해서입니다.",
        ratios: [
          {
            label: "조회 범위",
            formula: "bgn_de = 오늘 − 1년, end_de = 오늘, sort = date desc, page_count = 10",
            meaning:
              "보고서 본문(document.xml)은 한글 문서(HWP) 기반이라 파싱이 어려워 범위에서 제외했고(PRD 범위 제외 참고), 제목·접수일자만 가져옵니다.",
          },
        ],
      },
      {
        category: "② AI 쟁점 판단 — Upstage Solar LLM",
        description:
          "가져온 공시 제목 목록을 번호를 매겨 Solar LLM에 전달하고, 각 번호마다 감사상 쟁점 여부(isIssue)와 이유(note)를 판단하도록 요청합니다. 유상증자·소송·임원변경·특수관계자거래·자기주식·담보제공·영업정지·감사인 지정처럼 감사 절차에 영향을 줄 수 있는 유형이면 쟁점으로 표시되고, 단순 지분보고 같은 정기 공시는 표시되지 않습니다.",
        ratios: [
          {
            label: "제목 재생성 대신 번호 매칭",
            formula: "LLM 응답은 {index, isIssue, note} — 제목 텍스트는 절대 다시 생성하지 않음",
            meaning:
              "LLM이 한글 제목을 그대로 다시 출력하게 하면 특수문자가 깨지거나 미묘하게 다른 텍스트를 만들어낼 위험이 있어, 응답은 번호로만 받고 우리가 이미 갖고 있는 정확한 제목·접수일자를 번호 기준으로 그대로 붙입니다.",
          },
        ],
      },
      {
        category: "③ 한계와 주의사항",
        description:
          "이 기능은 공시 본문을 읽지 않고 제목만으로 1차 스크리닝하는 도구입니다.",
        ratios: [
          {
            label: "제목만으로 판단하는 한계",
            formula: "본문(document.xml) 미조회 — note에 \"본문 확인 필요\" 포함",
            meaning:
              "실제 쟁점의 구체적인 금액·상대방·조건은 본문을 열어봐야 알 수 있으므로, 쟁점으로 표시된 공시는 감사인이 직접 DART에서 원문을 확인해야 합니다. 이 도구는 검토할 공시를 골라내는 우선순위 필터일 뿐, 최종 판단을 대신하지 않습니다.",
          },
        ],
      },
    ],
  },
  "대시보드 & 리포트": {
    intro:
      "앞선 기능들(재무비율·이상변동계정·이상탐지 모델·감사 체크리스트)에서 이미 계산된 결과를 한 화면에서 시각화하고, 그대로 감사조서 형태의 PDF·Word 문서로 내보냅니다. 숫자 표로만 보던 분석 결과를 차트로 바꿔 이상 신호를 한눈에 파악하고, 조서 문서로 저장해 감사 문서화(ISA 230)에 활용하도록 돕는 마무리 단계입니다.",
    categories: [
      {
        category: "① 시각화 — recharts 차트",
        description:
          "분석 결과 중 시각화가 의미 있는 항목을 골라 차트로 보여줍니다. 새로 계산하는 값은 없고, 다른 탭에 이미 표시된 결과를 그래프 형태로 다시 그리는 것입니다.",
        ratios: [
          {
            label: "이상 변동 계정 · Benford 분포 차트",
            formula: "전기/당기 금액 그룹 막대그래프 + 실제/기대 분포 비교 막대그래프",
            meaning:
              "증감률이 큰 상위 계정의 전기 대비 당기 금액을 나란히 비교하고, Benford's Law는 실제 첫자리 분포와 기대 분포를 겹쳐 보여 벗어난 자릿수를 바로 눈으로 찾을 수 있게 합니다.",
          },
          {
            label: "점수 게이지 (Beneish · Altman)",
            formula: "점수 위치를 기준선(−1.78 / 1.23·2.9)과 함께 막대로 표시",
            meaning:
              "M-Score·Z′-Score를 숫자만이 아니라 기준선 대비 어느 위치에 있는지 색(정상/주의/위험)으로 보여줘 판단을 돕습니다.",
          },
        ],
      },
      {
        category: "② 리포트 export — PDF · Word",
        description:
          "화면의 분석 결과를 감사조서 형태 문서로 내보냅니다. 재무비율, 이상 변동 계정, 이상탐지 모델 결과, (생성된 경우) 감사 체크리스트가 하나의 문서에 정리됩니다.",
        ratios: [
          {
            label: "PDF — 화면 렌더링 방식",
            formula: "조서 레이아웃을 HTML로 만들어 html2canvas로 캡처 후 jsPDF로 A4 저장",
            meaning:
              "한글 폰트 임베딩 문제 없이 화면에 보이는 그대로를 PDF로 만들기 위해, 텍스트를 이미지로 렌더링해 저장합니다.",
          },
          {
            label: "Word — 편집 가능한 문서",
            formula: "docx 라이브러리로 제목·표·문단을 구조화한 .docx 생성",
            meaning:
              "감사인이 조서에 추가로 코멘트를 달거나 수정할 수 있도록, 이미지가 아닌 실제 편집 가능한 표·문단 형태로 만듭니다.",
          },
        ],
      },
      {
        category: "③ 한계와 주의사항",
        description:
          "리포트는 브라우저에서 즉석 생성되는 분석 초안입니다.",
        ratios: [
          {
            label: "클라이언트 생성 · 저장 없음",
            formula: "PDF·Word 모두 브라우저에서 생성·다운로드 — 서버 저장 없음",
            meaning:
              "PRD에는 Supabase Storage 저장이 예정돼 있으나 아직 백엔드가 없어, 현재는 파일이 사용자 기기로만 다운로드되고 서버에는 남지 않습니다. 조서 내용은 AI·자동계산 기반 초안이므로 감사인의 검토·서명이 필요합니다.",
          },
        ],
      },
    ],
  },
};

/** "핵심 기능" 카드 클릭 시 그리드 대신 렌더링되는 상세 설명 화면. */
function FeatureDetail({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  const detail = FEATURE_DETAILS[title];
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800"
      >
        ← 핵심 기능 목록으로
      </button>
      <h2 className="mt-3 text-xl font-semibold text-slate-900 sm:text-2xl">
        {title}
      </h2>

      {!detail ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-400">
          이 기능에 대한 상세 설명은 준비 중입니다.
        </p>
      ) : (
        <div className="mt-4 space-y-8">
          <div className="flex items-start gap-2 max-w-3xl">
            <span className="mt-0.5 shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">
              개요
            </span>
            <p className="text-sm leading-7 text-slate-600">{detail.intro}</p>
          </div>
          {detail.categories.map((cat, catIndex) => (
            <div key={cat.category}>
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {catIndex + 1}
                </span>
                {cat.category}
              </h3>
              <div className="mt-1.5 flex items-start gap-2 max-w-3xl">
                <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                  개념
                </span>
                <p className="text-sm leading-6 text-slate-600">
                  {cat.description}
                </p>
              </div>
              <div className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                {cat.ratios.map((r) => (
                  <div key={r.label} className="p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      {r.label}
                    </p>
                    <div className="mt-2 flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        공식
                      </span>
                      <span className="font-mono text-xs leading-5 text-slate-600">
                        {r.formula}
                      </span>
                    </div>
                    <div className="mt-2 flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">
                        의미
                      </span>
                      <p className="text-sm leading-6 text-slate-600">
                        {r.meaning}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRatioValue(value: number | null, unit: "%" | "배" | "원") {
  if (value == null) return "데이터 부족";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "배") return `${value.toFixed(2)}배`;
  return `${Math.round(value).toLocaleString()}원`;
}

/** 상장기업(DART)은 규모가 커서 백만원 단위, 비상장기업(엑셀 업로드·AI
 * 인식)은 상대적으로 규모가 작은 경우가 많아 천원 단위로 환산해 보여준다. */
type AmountUnit = "million" | "thousand";

function formatAmountByUnit(value: number, unit: AmountUnit): string {
  const divisor = unit === "million" ? 1_000_000 : 1_000;
  return Math.round(value / divisor).toLocaleString();
}

function amountUnitLabel(unit: AmountUnit): string {
  return unit === "million" ? "백만원" : "천원";
}

type BsSide = "asset" | "liability" | "equity";

/** 계정명에 포함된 키워드로 재무상태표 계정을 차변(자산)/대변(부채·자본)으로
 * 분류한다. "부채와자본총계"처럼 양쪽 키워드가 다 있는 합계행은 자산총계와
 * 금액이 같은 중복 합계라 T계정에서는 제외한다. 키워드가 없는 계정(매출채권,
 * 미수금, 예수금 등)은 원본 재무제표 순서상 직전 계정과 같은 변(side)에
 * 속한다고 보고 이어받는다 — DART가 내려주는 ord 순서는 자산 항목들, 자본
 * 항목들, 부채 항목들이 각각 묶여 나열되기 때문에 이 방식이 안전하다. */
function classifyBsSide(accountName: string, carried: BsSide): BsSide | "total" {
  const hasLiability = accountName.includes("부채");
  const hasEquity = accountName.includes("자본");
  if (hasLiability && hasEquity) return "total";
  if (hasEquity) return "equity";
  if (hasLiability) return "liability";
  if (accountName.includes("자산")) return "asset";
  return carried;
}

/** 각 변(side) 안에서 "○○총계" 합계행을 맨 아래로 내린다. DART의 ord 순서는
 * 자산총계·자본총계 같은 합계를 그 구성항목 위에 두는 경우가 있어(예: 자본총계가
 * 자본금·이익잉여금·기타자본항목보다 위), 실제 재무상태표 양식처럼 구성항목을
 * 먼저 나열하고 합계를 맨 아래에 오도록 재정렬한다. */
function moveTotalsLast(rows: AccountChange[]): AccountChange[] {
  const totals = rows.filter((r) => r.account.includes("총계"));
  const rest = rows.filter((r) => !r.account.includes("총계"));
  return [...rest, ...totals];
}

function splitBsForTAccount(changes: AccountChange[]) {
  const assets: AccountChange[] = [];
  const liabilities: AccountChange[] = [];
  const equity: AccountChange[] = [];
  let carried: BsSide = "asset";
  for (const c of changes) {
    const side = classifyBsSide(c.account, carried);
    if (side === "total") continue;
    carried = side;
    if (side === "asset") assets.push(c);
    else if (side === "liability") liabilities.push(c);
    else equity.push(c);
  }
  return {
    assets: moveTotalsLast(assets),
    liabilities: moveTotalsLast(liabilities),
    equity: moveTotalsLast(equity),
  };
}

function TAccountRows({
  changes,
  unit,
  compact = false,
}: {
  changes: AccountChange[];
  unit: AmountUnit;
  compact?: boolean;
}) {
  const textSize = compact ? "text-xs" : "text-sm";
  const cellPad = compact ? "px-2 py-1.5" : "px-3 py-2";
  const unitLabel = amountUnitLabel(unit);
  return (
    <table className={`w-full ${textSize}`}>
      <thead className="sticky top-0 bg-white">
        <tr>
          <th
            className={`border-b border-slate-200 ${cellPad} text-left font-medium text-slate-500`}
          >
            계정과목
          </th>
          <th
            className={`border-b border-slate-200 ${cellPad} text-right font-medium text-slate-500`}
          >
            전기({unitLabel})
          </th>
          <th
            className={`border-b border-slate-200 ${cellPad} text-right font-medium text-slate-500`}
          >
            당기({unitLabel})
          </th>
          <th
            className={`border-b border-slate-200 ${cellPad} text-right font-medium text-slate-500`}
          >
            증감률
          </th>
        </tr>
      </thead>
      <tbody>
        {changes.length === 0 ? (
          <tr>
            <td colSpan={4} className={`${cellPad} text-center text-slate-400`}>
              표시할 계정이 없습니다.
            </td>
          </tr>
        ) : (
          changes.map((c, i) => {
            const isTotal = c.account.includes("총계");
            return (
            <tr
              key={`${c.account}-${i}`}
              className={`${c.isAbnormal ? "bg-red-50" : ""} ${
                isTotal ? "border-t-2 border-slate-300 bg-slate-50" : ""
              }`}
            >
              <td
                className={`border-b border-slate-100 ${cellPad} ${
                  isTotal
                    ? "font-bold text-slate-900"
                    : "text-slate-700"
                }`}
                style={{ wordBreak: "keep-all" }}
              >
                {c.account}
              </td>
              <td
                className={`border-b border-slate-100 ${cellPad} text-right ${
                  isTotal ? "font-bold text-slate-900" : "text-slate-600"
                }`}
              >
                {formatAmountByUnit(c.prior, unit)}
              </td>
              <td
                className={`border-b border-slate-100 ${cellPad} text-right ${
                  isTotal ? "font-bold text-slate-900" : "text-slate-600"
                }`}
              >
                {formatAmountByUnit(c.current, unit)}
              </td>
              <td
                className={`border-b border-slate-100 ${cellPad} text-right font-medium ${
                  c.isAbnormal
                    ? "text-red-600"
                    : isTotal
                      ? "font-bold text-slate-900"
                      : "text-slate-600"
                }`}
              >
                {c.changeRate == null
                  ? c.isNew
                    ? "신규"
                    : "-"
                  : `${c.changeRate.toFixed(1)}%`}
                {c.isAbnormal && " ⚠"}
              </td>
            </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

/** "재무상태표"/"손익계산서" 버튼을 눌렀을 때 뜨는 큰 화면 모달. 계정 수가
 * 많아도 읽기 편하도록 작은 인라인 테이블보다 글자 크기와 여백을 키운다.
 * 재무상태표는 왼쪽 자산·오른쪽 부채/자본으로 나눈 T계정 형태로, 손익계산서는
 * 단일 목록으로 보여준다. */
function StatementModal({
  title,
  changes,
  unit,
  layout = "list",
  onClose,
}: {
  title: string;
  changes: AccountChange[];
  unit: AmountUnit;
  layout?: "list" | "t-account";
  onClose: () => void;
}) {
  const { assets, liabilities, equity } =
    layout === "t-account"
      ? splitBsForTAccount(changes)
      : { assets: [], liabilities: [], equity: [] };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[85vh] w-full flex-col rounded-xl bg-white shadow-xl ${
          layout === "t-account" ? "max-w-6xl" : "max-w-3xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h4 className="text-base font-semibold text-slate-900">{title}</h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M18 6 6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {layout === "t-account" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-slate-300">
              <div className="sm:pr-4">
                <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                  자산
                </p>
                <TAccountRows changes={assets} unit={unit} compact />
              </div>
              <div className="mt-4 sm:mt-0 sm:pl-4">
                <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                  부채
                </p>
                <TAccountRows changes={liabilities} unit={unit} compact />
                <p className="mb-1 mt-4 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                  자본
                </p>
                <TAccountRows changes={equity} unit={unit} compact />
              </div>
            </div>
          ) : (
            <TAccountRows changes={changes} unit={unit} />
          )}
        </div>
      </div>
    </div>
  );
}



type ChecklistItem = {
  risk: string;
  procedure: string;
  isaReference: string;
};

type DisclosureReviewItem = {
  reportName: string;
  receiptDate: string;
  receiptNo: string;
  isIssue: boolean;
  note: string;
};

/** 재무비율 중 통상적인 위험 기준을 벗어나는 것만 골라낸다. 재무비율 계산 및
 * 분석 화면에 이미 표시된 값을 그대로 재사용하며 따로 재계산하지 않는다. */
const RATIO_RISK_RULES: {
  match: (label: string) => boolean;
  isRisky: (value: number) => boolean;
  describe: (label: string, value: number) => string;
}[] = [
  {
    match: (l) => l.includes("유동비율"),
    isRisky: (v) => v < 100,
    describe: (l, v) => `${l} ${v.toFixed(1)}%로 100% 미만 — 단기 채무상환능력 우려`,
  },
  {
    match: (l) => l.includes("부채비율"),
    isRisky: (v) => v > 200,
    describe: (l, v) => `${l} ${v.toFixed(1)}%로 200% 초과 — 재무레버리지 과다`,
  },
  {
    match: (l) => l.includes("이자보상배율"),
    isRisky: (v) => v < 1,
    describe: (l, v) => `${l} ${v.toFixed(2)}배로 1배 미만 — 이자지급능력 부족`,
  },
  {
    match: (l) => l.includes("영업이익률"),
    isRisky: (v) => v < 0,
    describe: (l, v) => `${l} ${v.toFixed(1)}%로 적자`,
  },
  {
    match: (l) => l.includes("순이익률"),
    isRisky: (v) => v < 0,
    describe: (l, v) => `${l} ${v.toFixed(1)}%로 적자`,
  },
  {
    match: (l) => l.includes("ROE"),
    isRisky: (v) => v < 0,
    describe: (l, v) => `${l} ${v.toFixed(1)}%로 마이너스 — 자기자본 잠식 우려`,
  },
];

function findRatioRisks(ratioGroups: { category: string; ratios: Ratio[] }[]): string[] {
  const lines: string[] = [];
  for (const group of ratioGroups) {
    for (const ratio of group.ratios) {
      if (ratio.value == null) continue;
      const rule = RATIO_RISK_RULES.find((r) => r.match(ratio.label));
      if (rule && rule.isRisky(ratio.value)) {
        lines.push(`[재무비율] ${rule.describe(ratio.label, ratio.value)}`);
      }
    }
  }
  return lines;
}

/** 재무비율 임계치 이탈, 교차검증 위험 신호, 전기 대비 이상 변동 계정, 그리고
 * 이상탐지 모델(Beneish/Altman/Benford/RSF/라운드트립) 판정 결과까지 한 줄씩
 * 텍스트로 정리해 감사 체크리스트 생성 API에 넘긴다. 이미 화면에 계산·
 * 표시된 값만 재사용하고, "이상"으로 판정된 항목만 포함한다. */
function buildRiskSummary(params: {
  bsChanges: AccountChange[];
  isChanges: AccountChange[];
  crossChecks: CrossCheckFlag[];
  ratioGroups: { category: string; ratios: Ratio[] }[];
  beneishResult: BeneishResult | null;
  altmanResult: AltmanResult | null;
  benfordResult: BenfordResult | null;
  rsfFlags: RsfFlag[];
  roundTripFlags: RoundTripFlag[];
}): string {
  const {
    bsChanges,
    isChanges,
    crossChecks,
    ratioGroups,
    beneishResult,
    altmanResult,
    benfordResult,
    rsfFlags,
    roundTripFlags,
  } = params;
  const lines: string[] = [];

  findRatioRisks(ratioGroups).forEach((line) => lines.push(line));

  crossChecks.forEach((c) => lines.push(`[교차검증] ${c.detail}`));

  [...bsChanges, ...isChanges]
    .filter((c) => c.isAbnormal)
    .forEach((c) => {
      const rate = c.changeRate == null
        ? c.isNew
          ? "신규 계정(전기 0)"
          : "-"
        : `${c.changeRate.toFixed(1)}%`;
      lines.push(
        `[이상변동] ${c.account}: 전기 ${c.prior.toLocaleString()} → 당기 ${c.current.toLocaleString()} (증감률 ${rate})`
      );
    });

  if (beneishResult?.isSuspicious) {
    lines.push(
      `[Beneish M-Score] ${beneishResult.score.toFixed(2)} (기준 −1.78 초과) — 이익조작 가능성 높음`
    );
  }

  if (altmanResult && altmanResult.zone !== "safe") {
    const zoneLabel =
      altmanResult.zone === "distress" ? "위험지대" : "회색지대";
    lines.push(
      `[Altman Z'-Score] ${altmanResult.score.toFixed(2)} (${zoneLabel}) — 계속기업 가정 관련 주의 필요`
    );
  }

  if (benfordResult?.isSuspicious) {
    lines.push(
      `[Benford's Law] 표본 ${benfordResult.sampleSize}건, 첫자리 MAD ${benfordResult.mad.toFixed(4)} (Nigrini 기준 경계/부적합) — 거래금액 분포가 정상 범위에서 벗어남`
    );
  }

  rsfFlags.forEach((f) => {
    lines.push(
      `[RSF 테스트] ${f.account} 계정: 최대금액이 2번째로 큰 금액의 ${f.rsf.toFixed(1)}배 — 이상치 거래 가능성`
    );
  });

  roundTripFlags.forEach((f) => {
    lines.push(
      `[라운드트립 탐지] 거래처 ${f.counterparty}: 매출 ${f.saleAmount.toLocaleString()}원(${f.saleAccount}, ${f.saleDate}) ↔ 매입 ${f.purchaseAmount.toLocaleString()}원(${f.purchaseAccount}, ${f.purchaseDate}), ${f.daysApart}일 간격 — 2자간 상계성 거래 의심`
    );
  });

  return lines.join("\n");
}

const BENFORD_CONFORMITY_LABEL: Record<string, string> = {
  close: "근접 적합(정상)",
  acceptable: "허용 가능(정상)",
  marginal: "경계 — 검토 권장",
  nonconform: "부적합 — 이상",
};

function AnalysisDetail({
  financials,
  source,
  companyName,
  corpCode,
  stockCode,
  journalRows,
  onAttachJournalRows,
  trialBalanceRows,
  onAttachTrialBalance,
  requestId,
  sessionId,
  backendConfigured,
}: {
  financials: NormalizedFinancials;
  source: AnalysisRequest["source"];
  companyName: string;
  corpCode?: string;
  stockCode?: string;
  journalRows?: JournalRow[];
  onAttachJournalRows: (rows: JournalRow[]) => void;
  trialBalanceRows?: TrialBalanceRow[];
  onAttachTrialBalance: (rows: TrialBalanceRow[]) => void;
  requestId: string;
  sessionId: string;
  backendConfigured: boolean;
}) {
  // 서버 백엔드가 켜져 있을 때만 감사 이벤트를 append한다(불변 감사증적).
  const logEvent = (
    eventType: string,
    detail?: Record<string, unknown>
  ) => {
    if (backendConfigured) {
      void appendServerEvent(sessionId, requestId, eventType, detail);
    }
  };
  const unit: AmountUnit = source === "dart" ? "million" : "thousand";

  const [materialityInput, setMaterialityInput] = useState("");
  const materialityAmount =
    Number(materialityInput.replace(/,/g, "").trim()) || 0;

  // ISA 320 중요성 산정. 여기서 나온 수행중요성이 이상 변동 필터·MUS 허용왜곡
  // 금액·미수정왜곡 집계표의 판단 기준으로 함께 쓰인다.
  const [matBenchmark, setMatBenchmark] =
    useState<BenchmarkKey>("법인세차감전순이익");
  const [matRateInput, setMatRateInput] = useState("5");
  const [matRisk, setMatRisk] = useState<RiskLevel>("normal");
  const [matAmountInput, setMatAmountInput] = useState("");

  // 미수정왜곡사항 집계표(ISA 450)
  const [misstatements, setMisstatements] = useState<Misstatement[]>([]);
  const [sumDescInput, setSumDescInput] = useState("");
  const [sumAmountInput, setSumAmountInput] = useState("");
  const [sumTypeInput, setSumTypeInput] = useState<MisstatementType>("factual");
  const [stockPriceInput, setStockPriceInput] = useState("");
  const stockPrice = Number(stockPriceInput.replace(/,/g, "").trim()) || null;
  const [stockPriceFetching, setStockPriceFetching] = useState(false);
  const [stockPriceMeta, setStockPriceMeta] = useState<{
    isMarketOpen: boolean;
    tradedAt: string | null;
  } | null>(null);
  const [openStatement, setOpenStatement] = useState<"bs" | "is" | null>(
    null
  );
  const [openIsaReference, setOpenIsaReference] = useState<string | null>(
    null
  );

  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistError, setChecklistError] = useState<string | null>(null);

  const [disclosureItems, setDisclosureItems] = useState<
    DisclosureReviewItem[] | null
  >(null);
  const [disclosureLoading, setDisclosureLoading] = useState(false);
  const [disclosureError, setDisclosureError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    | "ratio"
    | "anomaly"
    | "je"
    | "tb"
    | "materiality"
    | "sum"
    | "checklist"
    | "disclosure"
    | "mus"
    | "dashboard"
  >("ratio");

  const [jeApprovalLimitInput, setJeApprovalLimitInput] = useState("");

  const [tbFileName, setTbFileName] = useState<string | null>(null);
  const [tbParsing, setTbParsing] = useState(false);
  const [tbError, setTbError] = useState<string | null>(null);

  const [pdfExporting, setPdfExporting] = useState(false);
  const [wordExporting, setWordExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [musConfidenceLevel, setMusConfidenceLevel] =
    useState<MusConfidenceLevel>(95);
  const [musPopulationInput, setMusPopulationInput] = useState("");
  const [musTolerableInput, setMusTolerableInput] = useState("");
  const [musExpectedRateInput, setMusExpectedRateInput] = useState("");

  const [journalFileName, setJournalFileName] = useState<string | null>(null);
  const [journalUploadParsing, setJournalUploadParsing] = useState(false);
  const [journalUploadError, setJournalUploadError] = useState<string | null>(
    null
  );

  async function handleJournalFileChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file) return;

    setJournalFileName(file.name);
    setJournalUploadError(null);
    setJournalUploadParsing(true);
    try {
      const parsed = await parseFinancialTemplate(file);
      if (parsed.journalRows.length === 0) {
        throw new Error(
          "전표데이터 시트를 찾지 못했거나 비어 있습니다. 표준 템플릿의 '전표데이터' 시트 형식을 확인해주세요."
        );
      }
      onAttachJournalRows(parsed.journalRows);
    } catch (err) {
      setJournalUploadError(
        err instanceof Error
          ? err.message
          : "전표데이터를 읽는 중 오류가 발생했습니다."
      );
    } finally {
      setJournalUploadParsing(false);
    }
  }

  async function handleTbFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setTbFileName(file.name);
    setTbError(null);
    setTbParsing(true);
    try {
      const rows = await parseTrialBalance(file);
      if (rows.length === 0) {
        throw new Error(
          "시산표 데이터를 찾지 못했거나 비어 있습니다. '시산표' 시트(계정코드·계정과목·기초잔액·당기차변·당기대변·기말잔액) 형식을 확인해주세요."
        );
      }
      onAttachTrialBalance(rows);
    } catch (err) {
      setTbError(
        err instanceof Error
          ? err.message
          : "시산표를 읽는 중 오류가 발생했습니다."
      );
    } finally {
      setTbParsing(false);
    }
  }

  const tbCheck = trialBalanceRows ? checkTrialBalance(trialBalanceRows) : null;

  const ratioGroups = calculateRatios(financials);
  const valuationRatios = calculateValuationRatios(financials, stockPrice);
  const displayGroups: { category: string; ratios: Ratio[] }[] = [
    ...ratioGroups,
    // 가치평가(EPS/BPS/PER/PBR)는 투자자용 주가지표로, 감사증거나 분석적 절차의
    // 대상이 아니다. 감사 지표와 섞이지 않도록 "참고용 시장지표"로 격하 표기한다.
    { category: "참고용 시장지표", ratios: valuationRatios },
  ];
  const crossChecks = crossCheckAccounts(financials);

  // Beneish M-Score/Altman Z-Score는 재무제표 요약만으로 계산되므로 입력
  // 경로와 무관하게 항상 시도한다. Benford's Law/RSF/라운드트립 탐지는 거래
  // 단위 데이터(전표데이터)가 필요해 엑셀 업로드 경로에만 journalRows가 있다.
  const beneishResult = calculateBeneishMScore(financials);
  const altmanResult = calculateAltmanZScore(financials);
  const benfordResult = journalRows
    ? runBenfordTest(
        journalRows.flatMap((r) => [r.debit, r.credit]).filter((v) => v > 0)
      )
    : null;
  const rsfFlags = journalRows ? runRsfTest(journalRows) : [];
  const roundTripFlags = journalRows
    ? detectRoundTripTransactions(journalRows)
    : [];

  // 재무상태표/손익계산서 모두 실제 재무제표 양식(원본 순서)을 그대로 유지한다.
  const bsChanges = calculateAccountChanges(
    financials.bs,
    20,
    materialityAmount
  );
  const isChanges = calculateAccountChanges(
    financials.is,
    20,
    materialityAmount
  );

  const totalAssets = findAccountValue(financials.bs, "자산총계", "current");

  function handleSuggestMateriality() {
    if (totalAssets == null) return;
    setMaterialityInput(Math.round(totalAssets * 0.01).toLocaleString());
  }

  function handleMaterialityInputChange(value: string) {
    const digitsOnly = value.replace(/[^0-9]/g, "");
    setMaterialityInput(digitsOnly ? Number(digitsOnly).toLocaleString() : "");
  }

  function handleMusAmountInputChange(
    setter: (value: string) => void,
    value: string
  ) {
    const digitsOnly = value.replace(/[^0-9]/g, "");
    setter(digitsOnly ? Number(digitsOnly).toLocaleString() : "");
  }

  // ── 중요성(ISA 320) ────────────────────────────────────────────────
  const matBenchmarkOption =
    BENCHMARKS.find((b) => b.key === matBenchmark) ?? BENCHMARKS[0];
  /** 재무제표에서 읽은 벤치마크 원값. 손익 항목은 적자면 음수로 나온다. */
  const matReadAmount = readBenchmarkAmount(financials, matBenchmark);
  /** 사용자가 직접 입력했으면 그 값을, 아니면 재무제표에서 읽은 값을 쓴다. */
  const matAmount =
    matAmountInput.trim() !== ""
      ? Number(matAmountInput.replace(/,/g, "").trim()) || 0
      : matReadAmount ?? 0;
  const matRate = Number(matRateInput) || 0;
  const materialityResult = calculateMateriality({
    benchmark: matBenchmark,
    benchmarkAmount: matAmount,
    rate: matRate,
    risk: matRisk,
  });
  /** 이익 기준인데 적자면 그 벤치마크는 부적절하다는 경고를 띄운다. */
  const matBenchmarkIsLoss =
    matReadAmount != null &&
    matReadAmount <= 0 &&
    (matBenchmark === "법인세차감전순이익" || matBenchmark === "매출액");
  const matRateOutOfRange =
    matRate > 0 &&
    (matRate < matBenchmarkOption.minRate || matRate > matBenchmarkOption.maxRate);

  function handleSelectBenchmark(key: BenchmarkKey) {
    setMatBenchmark(key);
    const opt = BENCHMARKS.find((b) => b.key === key);
    if (opt) setMatRateInput(String(opt.defaultRate));
    // 벤치마크가 바뀌면 직접 입력값은 비워 재무제표 값을 다시 읽게 한다.
    setMatAmountInput("");
  }

  // ── 미수정왜곡사항 집계(ISA 450) ──────────────────────────────────
  const misstatementSummary = summarizeMisstatements(
    misstatements,
    materialityResult?.overall ?? 0,
    materialityResult?.clearlyTrivial ?? 0
  );

  function handleAddMisstatement() {
    const desc = sumDescInput.trim();
    const amount = Number(sumAmountInput.replace(/[^0-9-]/g, "")) || 0;
    if (!desc || amount === 0) return;
    setMisstatements((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        description: desc,
        type: sumTypeInput,
        incomeEffect: amount,
        corrected: false,
        source: "manual",
      },
    ]);
    setSumDescInput("");
    setSumAmountInput("");
  }

  /** 시산표 roll-forward 불일치는 장부상 확인된 차이라 사실왜곡 후보로 끌어온다. */
  function handleImportTbMismatches() {
    if (!tbCheck || tbCheck.rollForwardMismatches.length === 0) return;
    const existing = new Set(
      misstatements.filter((m) => m.source === "trialBalance").map((m) => m.description)
    );
    const imported: Misstatement[] = tbCheck.rollForwardMismatches
      .map((m) => ({
        id: crypto.randomUUID(),
        description: `[시산표] ${m.account} roll-forward 불일치`,
        type: "factual" as const,
        incomeEffect: m.diff,
        corrected: false,
        source: "trialBalance" as const,
      }))
      .filter((m) => !existing.has(m.description));
    if (imported.length === 0) return;
    setMisstatements((prev) => [...prev, ...imported]);
  }

  function handleToggleCorrected(id: string) {
    setMisstatements((prev) =>
      prev.map((m) => (m.id === id ? { ...m, corrected: !m.corrected } : m))
    );
  }

  function handleRemoveMisstatement(id: string) {
    setMisstatements((prev) => prev.filter((m) => m.id !== id));
  }

  /** 산정한 수행중요성을 실제로 쓰는 곳(이상 변동 필터·MUS)으로 흘려보낸다. */
  function handleApplyMateriality() {
    if (!materialityResult) return;
    const pm = Math.round(materialityResult.performance);
    setMaterialityInput(pm.toLocaleString());
    setMusTolerableInput(pm.toLocaleString());
    logEvent("materiality_applied", {
      benchmark: matBenchmark,
      rate: matRate,
      risk: matRisk,
      overall: Math.round(materialityResult.overall),
      performance: pm,
    });
  }

  const musAccountOptions = [
    ...financials.bs.map((r) => ({ ...r, stmt: "재무상태표" as const })),
    ...financials.is.map((r) => ({ ...r, stmt: "손익계산서" as const })),
  ].filter((r) => r.current !== 0 && isMusEligibleAccount(r.account));

  function handleMusSelectAccount(accountKey: string) {
    if (!accountKey) return;
    const [stmt, account] = accountKey.split("::");
    const row = musAccountOptions.find(
      (r) => r.stmt === stmt && r.account === account
    );
    if (!row) return;
    setMusPopulationInput(Math.round(Math.abs(row.current)).toLocaleString());
  }

  const musPopulationAmount =
    Number(musPopulationInput.replace(/,/g, "").trim()) || 0;
  const musTolerableMisstatement =
    Number(musTolerableInput.replace(/,/g, "").trim()) || 0;
  const musExpectedMisstatementRate =
    Number(musExpectedRateInput.replace(/,/g, "").trim()) || 0;

  const musResult = calculateMusSampleSize({
    confidenceLevel: musConfidenceLevel,
    populationAmount: musPopulationAmount,
    tolerableMisstatement: musTolerableMisstatement,
    expectedMisstatementRate: musExpectedMisstatementRate,
  });

  function handleStockPriceInputChange(value: string) {
    const digitsOnly = value.replace(/[^0-9]/g, "");
    setStockPriceInput(digitsOnly ? Number(digitsOnly).toLocaleString() : "");
    setStockPriceMeta(null);
  }

  async function handleFetchStockPrice() {
    if (!stockCode) return;
    setStockPriceFetching(true);
    setStockPriceMeta(null);
    try {
      const res = await fetch(`/api/stock-price?code=${stockCode}`);
      const data = await res.json();
      if (res.ok && typeof data.price === "number") {
        setStockPriceInput(data.price.toLocaleString());
        setStockPriceMeta({
          isMarketOpen: Boolean(data.isMarketOpen),
          tradedAt: data.tradedAt ?? null,
        });
      }
    } catch {
      // 자동조회 실패 시 조용히 무시 — 사용자가 직접 입력하면 된다.
    } finally {
      setStockPriceFetching(false);
    }
  }

  async function handleGenerateChecklist() {
    const riskSummary = buildRiskSummary({
      bsChanges,
      isChanges,
      crossChecks,
      ratioGroups,
      beneishResult,
      altmanResult,
      benfordResult,
      rsfFlags,
      roundTripFlags,
    });
    if (!riskSummary) {
      setChecklistError("현재 감지된 위험 신호가 없어 체크리스트를 만들 수 없습니다.");
      return;
    }
    // 기밀성: 위험 신호가 외부 AI(Upstage Solar)로 전송되므로 사전 동의 확인
    if (!ensureThirdPartyAiConsent()) return;
    setChecklistLoading(true);
    setChecklistError(null);
    try {
      // 데이터 최소화: 감사 대상 회사명은 체크리스트 생성에 불필요하므로
      // 외부 AI로 전송하지 않는다(식별정보 축소).
      const res = await fetch("/api/upstage/checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riskSummary }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "체크리스트 생성 중 오류가 발생했습니다.");
      }
      setChecklist(data.checklist);
      logEvent("checklist_generated", {
        count: Array.isArray(data.checklist) ? data.checklist.length : 0,
      });
    } catch (err) {
      setChecklistError(
        err instanceof Error ? err.message : "체크리스트 생성 중 오류가 발생했습니다."
      );
    } finally {
      setChecklistLoading(false);
    }
  }

  async function handleSummarizeDisclosures() {
    if (!corpCode) return;
    // 기밀성: 공시 제목이 외부 AI(Upstage Solar)로 전송된다(공개 데이터이나 동의 확인)
    if (!ensureThirdPartyAiConsent()) return;
    setDisclosureLoading(true);
    setDisclosureError(null);
    try {
      const listRes = await fetch(
        `/api/dart/disclosures?corp_code=${corpCode}`
      );
      const listData = await listRes.json();
      if (!listRes.ok) {
        throw new Error(listData.error ?? "공시 목록 조회 중 오류가 발생했습니다.");
      }
      if (!listData.disclosures || listData.disclosures.length === 0) {
        setDisclosureItems([]);
        return;
      }

      const sumRes = await fetch("/api/upstage/disclosure-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          disclosures: listData.disclosures.map(
            (d: {
              reportName: string;
              receiptDate: string;
              receiptNo: string;
            }) => ({
              reportName: d.reportName,
              receiptDate: d.receiptDate,
              receiptNo: d.receiptNo,
            })
          ),
        }),
      });
      const sumData = await sumRes.json();
      if (!sumRes.ok) {
        throw new Error(sumData.error ?? "공시 요약 중 오류가 발생했습니다.");
      }
      setDisclosureItems(sumData.items);
    } catch (err) {
      setDisclosureError(
        err instanceof Error ? err.message : "공시 요약 중 오류가 발생했습니다."
      );
    } finally {
      setDisclosureLoading(false);
    }
  }

  function buildAuditReportData(): AuditReportData {
    const sourceLabel =
      source === "dart"
        ? "DART 상장기업 검색"
        : source === "excel"
          ? "엑셀 템플릿 업로드"
          : "AI 이미지/PDF 자동인식";

    const abnormalAccounts = [...bsChanges, ...isChanges]
      .filter((c) => c.isAbnormal)
      .map((c) => ({
        account: c.account,
        prior: formatAmountByUnit(c.prior, unit),
        current: formatAmountByUnit(c.current, unit),
        changeRate:
          c.changeRate == null
            ? c.isNew
              ? "신규"
              : "N/A"
            : `${c.changeRate.toFixed(1)}%`,
      }));

    const now = new Date();
    const workpaperRef = `AR-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${(corpCode ?? stockCode ?? "NA").slice(0, 8)}`;
    const materialityBasis =
      materialityAmount > 0
        ? `수행 중요성 ${materialityAmount.toLocaleString()}원 (감사인 입력). 이상 변동 판정: 전기 대비 증감률 20% 이상이면서 변동 금액이 이 중요성 금액 이상인 계정.`
        : "중요성 금액 미입력 — 전기 대비 증감률 20% 기준만 적용. 실제 감사 시 감사인은 수행 중요성 금액을 산정해 이 조서에 기재해야 함.";

    return {
      companyName,
      sourceLabel,
      generatedAt: now.toLocaleString("ko-KR"),
      unit: amountUnitLabel(unit),
      workpaperRef,
      period: "당기 · 전기 비교 (대상 사업연도는 감사인이 기입)",
      materialityBasis,
      ratioGroups: displayGroups.map((g) => ({
        category: g.category,
        ratios: g.ratios.map((r) => ({
          label: r.label,
          value: formatRatioValue(r.value, r.unit),
        })),
      })),
      abnormalAccounts,
      beneish: beneishResult
        ? {
            score: beneishResult.score.toFixed(2),
            verdict: beneishResult.isSuspicious
              ? "이익조작 가능성 높음"
              : "정상 범위",
          }
        : null,
      altman: altmanResult
        ? {
            score: altmanResult.score.toFixed(2),
            verdict:
              altmanResult.zone === "safe"
                ? "안전지대"
                : altmanResult.zone === "grey"
                  ? "회색지대"
                  : "위험지대",
          }
        : null,
      benford: benfordResult
        ? {
            chiSquare: benfordResult.chiSquare.toFixed(2),
            sampleSize: benfordResult.sampleSize,
            verdict: benfordResult.isSuspicious
              ? "벤포드 분포에서 유의미하게 벗어남"
              : "정상 범위",
          }
        : null,
      rsfFlags: rsfFlags.map((f) => ({
        account: f.account,
        detail: `최대 ${f.largest.toLocaleString()} vs 2번째 ${f.secondLargest.toLocaleString()} (RSF ${f.rsf.toFixed(1)}배)`,
      })),
      roundTripFlags: roundTripFlags.map((f) => ({
        detail: `거래처 ${f.counterparty}: 매출 ${f.saleAmount.toLocaleString()}원(${f.saleAccount}) ↔ 매입 ${f.purchaseAmount.toLocaleString()}원(${f.purchaseAccount}), ${f.daysApart}일 간격`,
      })),
      checklist,
    };
  }

  async function handleExportPdf() {
    setExportError(null);
    setPdfExporting(true);
    try {
      await exportAuditReportPdf(buildAuditReportData());
      logEvent("report_exported", { format: "pdf" });
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "PDF 생성 중 오류가 발생했습니다."
      );
    } finally {
      setPdfExporting(false);
    }
  }

  async function handleExportWord() {
    setExportError(null);
    setWordExporting(true);
    try {
      await exportAuditReportWord(buildAuditReportData());
      logEvent("report_exported", { format: "word" });
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Word 생성 중 오류가 발생했습니다."
      );
    } finally {
      setWordExporting(false);
    }
  }

  const abnormalChartData = [...bsChanges, ...isChanges]
    .filter((c) => c.isAbnormal)
    .sort((a, b) => Math.abs(b.changeRate ?? 0) - Math.abs(a.changeRate ?? 0))
    .slice(0, 8)
    .map((c) => ({
      account: c.account,
      전기: Math.round(c.prior / (unit === "million" ? 1_000_000 : 1_000)),
      당기: Math.round(c.current / (unit === "million" ? 1_000_000 : 1_000)),
    }));

  const benfordChartData = benfordResult
    ? benfordResult.digits.map((d) => ({
        digit: String(d.digit),
        실제: Number(d.actualPercent.toFixed(1)),
        기대: Number(d.expectedPercent.toFixed(1)),
      }))
    : [];

  const jeApprovalLimit =
    Number(jeApprovalLimitInput.replace(/,/g, "").trim()) || 0;
  const jeTestSummary = journalRows
    ? runJournalEntryTests(journalRows, { approvalLimit: jeApprovalLimit })
    : null;

  // 전표 업로드 박스 — 이상탐지 탭과 전표 테스트 탭에서 공유한다.
  const journalUploadBox = (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3">
      {journalRows ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-600">
            전표데이터 {journalRows.length.toLocaleString()}건이 연결되어
            있습니다.
          </p>
          <label className="cursor-pointer text-xs font-medium text-blue-700 hover:text-blue-800">
            다른 파일로 교체
            <input
              type="file"
              accept=".xlsx"
              onChange={handleJournalFileChange}
              className="hidden"
            />
          </label>
        </div>
      ) : (
        <>
          <label className="flex cursor-pointer flex-col gap-1.5 text-xs">
            <span className="font-medium text-slate-700">
              전표데이터 업로드 (선택)
            </span>
            <span className="text-slate-400">
              표준 템플릿의 &apos;전표데이터&apos;
              시트 형식(전표번호·전기일자·전기시각·계정과목·거래처·차변·대변·작성자·승인자·적요)이어야
              합니다. 이 회사의 다른 재무제표 시트는 비어 있어도 됩니다.
            </span>
            <input
              type="file"
              accept=".xlsx"
              onChange={handleJournalFileChange}
              className="mt-1 block text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
          </label>
          <button
            type="button"
            onClick={() => onAttachJournalRows(SAMPLE_JOURNAL_ROWS)}
            className="mt-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            파일 없이 샘플 전표데이터로 체험하기 →
          </button>
          {journalFileName && journalUploadParsing && (
            <p className="mt-1.5 text-xs text-slate-400">
              {journalFileName} 읽는 중...
            </p>
          )}
          {journalUploadError && (
            <p className="mt-1.5 text-xs text-red-600">{journalUploadError}</p>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="mt-3 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              전기 대비 이상 변동 계정
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              증감률 20% 이상{materialityAmount > 0 && " · 변동액이 중요성 금액 이상"}
              인 계정만 하이라이트합니다. 재무상태표·손익계산서 모두 실제
              재무제표 순서 그대로 보여주며, 재무상태표는 자산·부채·자본으로
              나눈 T계정 형태로 확인할 수 있습니다. (금액 단위: {amountUnitLabel(unit)})
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="text-xs text-slate-500">
                중요성 금액 (원, 선택)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={materialityInput}
                onChange={(e) => handleMaterialityInputChange(e.target.value)}
                placeholder="예: 1,000,000,000"
                className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>
            {totalAssets != null && (
              <button
                type="button"
                onClick={handleSuggestMateriality}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                자산총계 1%로 설정
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOpenStatement("bs")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            재무상태표
            <span className="text-xs font-normal text-slate-400">
              ({bsChanges.length}개 계정
              {bsChanges.some((c) => c.isAbnormal) &&
                ` · 이상 ${bsChanges.filter((c) => c.isAbnormal).length}건`}
              )
            </span>
          </button>
          <button
            type="button"
            onClick={() => setOpenStatement("is")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            손익계산서
            <span className="text-xs font-normal text-slate-400">
              ({isChanges.length}개 계정
              {isChanges.some((c) => c.isAbnormal) &&
                ` · 이상 ${isChanges.filter((c) => c.isAbnormal).length}건`}
              )
            </span>
          </button>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4">
        <div className="space-y-3">
          {(
            [
              {
                group: "재무제표 스크리닝",
                hint: "공개·요약 데이터로 위험 신호를 1차 선별",
                tabs: [
                  { key: "ratio", label: "재무비율분석" },
                  { key: "anomaly", label: "이상탐지 모델" },
                  ...(corpCode
                    ? ([{ key: "disclosure", label: "최근공시요약" }] as const)
                    : []),
                ],
              },
              {
                group: "감사 실무",
                hint: "클라이언트 원장 기반 실증 절차·표본·조서",
                tabs: [
                  { key: "materiality", label: "중요성 산정" },
                  { key: "tb", label: "시산표 검증" },
                  { key: "je", label: "전표(JE) 테스트" },
                  { key: "mus", label: "MUS 샘플링" },
                  { key: "sum", label: "미수정왜곡 집계" },
                  { key: "checklist", label: "감사체크리스트 생성" },
                  { key: "dashboard", label: "대시보드 & 리포트" },
                ],
              },
            ] as const
          ).map((section) => (
            <div key={section.group}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {section.group}
                <span className="ml-1.5 font-normal normal-case text-slate-400">
                  · {section.hint}
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {section.tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      activeTab === tab.key
                        ? "bg-blue-700 text-white"
                        : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {activeTab === "ratio" && (
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {displayGroups.map((group) => (
                <div key={group.category}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {group.category}
                  </p>
                  {group.category === "참고용 시장지표" && (
                    <div className="mt-1 mb-1.5 flex flex-col gap-1">
                      <p className="text-[10px] leading-tight text-slate-400">
                        투자자용 주가지표 — 감사증거·분석적 절차 대상이 아닙니다(참고용).
                      </p>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={stockPriceInput}
                        onChange={(e) =>
                          handleStockPriceInputChange(e.target.value)
                        }
                        placeholder="주가 입력(원, PER·PBR용)"
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-medium text-slate-900 placeholder:text-xs placeholder:font-normal placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      />
                      {stockCode && (
                        <button
                          type="button"
                          onClick={handleFetchStockPrice}
                          disabled={stockPriceFetching}
                          className="group flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-700 px-2 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow disabled:cursor-not-allowed disabled:translate-y-0 disabled:bg-slate-300 disabled:shadow-none"
                        >
                          {stockPriceFetching ? (
                            <LoadingDots text="실시간 조회 중" />
                          ) : (
                            <>
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              </span>
                              실시간 주가 조회
                            </>
                          )}
                        </button>
                      )}
                      {stockPriceMeta && (
                        <p className="text-[11px] leading-tight text-slate-400">
                          {stockPriceMeta.isMarketOpen
                            ? "장중 실시간 체결가"
                            : "장마감 · 최종 체결가"}
                          {stockPriceMeta.tradedAt &&
                            ` · ${new Date(
                              stockPriceMeta.tradedAt
                            ).toLocaleString("ko-KR", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })} 기준`}
                        </p>
                      )}
                    </div>
                  )}
                  <ul className="mt-1.5 space-y-1">
                    {group.ratios.map((ratio) => (
                      <li key={ratio.label} className="text-xs leading-5">
                        <span className="text-slate-600">{ratio.label}</span>
                        <br />
                        <span
                          className={`font-semibold ${
                            ratio.value == null
                              ? "text-slate-400"
                              : "text-slate-900"
                          }`}
                        >
                          {formatRatioValue(ratio.value, ratio.unit)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {crossChecks.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800">
                  교차검증 위험 신호
                </p>
                <ul className="mt-1 space-y-1">
                  {crossChecks.map((flag) => (
                    <li key={flag.label} className="text-xs text-amber-800">
                      ⚠ {flag.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeTab === "anomaly" && (
          <div className="mt-3">
            <p className="text-xs text-slate-400">
              Beneish M-Score·Altman Z&apos;-Score는 재무제표만으로 계산됩니다.
              Benford&apos;s Law·RSF 테스트·라운드트립 탐지는 거래 단위 데이터(전표데이터)가
              있어야 계산되며, 엑셀 업로드가 아닌 DART·AI 인식 항목이라도 아래에서
              전표데이터를 별도로 업로드하면 함께 계산됩니다.
            </p>

            <div className="mt-3">{journalUploadBox}</div>

            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-900">
                  Beneish M-Score (이익조작 가능성)
                </p>
                {beneishResult ? (
                  <>
                    <p
                      className={`mt-1 text-lg font-bold ${
                        beneishResult.isSuspicious ? "text-red-600" : "text-slate-900"
                      }`}
                    >
                      {beneishResult.score.toFixed(2)}
                      {beneishResult.isSuspicious && " ⚠"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      기준치 −1.78보다{" "}
                      {beneishResult.isSuspicious
                        ? "커서 이익조작 가능성이 높게"
                        : "작아 통상 범위로"}{" "}
                      나타납니다.
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">
                    데이터 부족 (전기·당기 재무제표 전 항목 및 현금흐름표 필요)
                  </p>
                )}
                <p className="mt-1.5 text-[10px] leading-tight text-slate-400">
                  ※ 미국 상장 제조업 데이터로 만든 모델이라 국내·비제조·단일기업엔
                  오탐이 잦습니다. LVGI에 총부채, TATA에 당기순이익을 대용치로
                  씁니다. 부정 확정이 아닌 부정위험 평가(ISA 240) 참고용입니다.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-900">
                  Altman Z&apos;-Score (부도 가능성)
                </p>
                {altmanResult ? (
                  <>
                    <p
                      className={`mt-1 text-lg font-bold ${
                        altmanResult.zone === "distress"
                          ? "text-red-600"
                          : altmanResult.zone === "grey"
                            ? "text-amber-600"
                            : "text-slate-900"
                      }`}
                    >
                      {altmanResult.score.toFixed(2)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {altmanResult.zone === "safe" && "안전지대 (2.9 초과)"}
                      {altmanResult.zone === "grey" &&
                        "회색지대 (1.23~2.9, 주의 필요)"}
                      {altmanResult.zone === "distress" && "위험지대 (1.23 미만) ⚠"}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">데이터 부족</p>
                )}
                <p className="mt-1.5 text-[10px] leading-tight text-slate-400">
                  ※ 제조업용 Z′ 모델을 업종 구분 없이 적용하며, EBIT 대신
                  영업이익을 씁니다(서비스업은 Z″가 더 적합). 계속기업(ISA 570)
                  조기경보 참고용입니다.
                </p>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-700">
                Benford&apos;s Law — 거래금액 첫자리 분포
              </p>
              {!journalRows ? (
                <p className="mt-1 text-xs text-slate-400">
                  전표데이터가 없습니다. 위에서 업로드하면 계산됩니다.
                </p>
              ) : !benfordResult ? (
                <p className="mt-1 text-xs text-slate-400">
                  표본이 30건 미만이라 검정할 수 없습니다.
                </p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium text-slate-500">
                          첫자리
                        </th>
                        {benfordResult.digits.map((d) => (
                          <th
                            key={d.digit}
                            className="px-2 py-1.5 text-right font-medium text-slate-500"
                          >
                            {d.digit}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-2 py-1 text-slate-600">실제 %</td>
                        {benfordResult.digits.map((d) => (
                          <td
                            key={d.digit}
                            className="px-2 py-1 text-right text-slate-700"
                          >
                            {d.actualPercent.toFixed(1)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-2 py-1 text-slate-400">기대 %</td>
                        {benfordResult.digits.map((d) => (
                          <td
                            key={d.digit}
                            className="px-2 py-1 text-right text-slate-400"
                          >
                            {d.expectedPercent.toFixed(1)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                  <div
                    className={`border-t border-slate-200 px-2 py-1.5 text-xs ${
                      benfordResult.isSuspicious ? "text-red-600" : "text-slate-500"
                    }`}
                  >
                    <p>
                      표본 {benfordResult.sampleSize.toLocaleString()}건 · 첫자리
                      MAD {benfordResult.mad.toFixed(4)} —{" "}
                      {BENFORD_CONFORMITY_LABEL[benfordResult.conformity]}
                      {benfordResult.isSuspicious && " ⚠"}
                      {benfordResult.sampleSize < 500 && (
                        <span className="text-amber-600">
                          {" "}· 표본이 작아 판정 신뢰도 낮음(수백 건 이상 권장)
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      판정은 표본크기에 좌우되는 카이제곱(참고: {benfordResult.chiSquare.toFixed(1)} / 기준 15.51) 대신
                      표본크기에 무관한 MAD로 내립니다(Nigrini 기준).
                      {benfordResult.firstTwoMad != null &&
                        benfordResult.firstTwoConformity != null && (
                          <>
                            {" "}첫 두 자리 MAD {benfordResult.firstTwoMad.toFixed(4)} —{" "}
                            {BENFORD_CONFORMITY_LABEL[benfordResult.firstTwoConformity]}.
                          </>
                        )}
                      {benfordResult.firstTwoMad == null &&
                        " 첫 두 자리 검정은 표본 300건 이상일 때 표시됩니다."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-700">
                RSF 테스트 — 계정별 최대금액 이상치
              </p>
              {!journalRows ? (
                <p className="mt-1 text-xs text-slate-400">
                  전표데이터가 없습니다. 위에서 업로드하면 계산됩니다.
                </p>
              ) : rsfFlags.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">
                  이상치로 플래그된 계정이 없습니다.
                </p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {rsfFlags.map((f, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs"
                    >
                      <p className="font-medium text-slate-700">⚠ {f.account}</p>
                      <p className="mt-0.5 text-slate-600">
                        최대 {f.largest.toLocaleString()} vs 2번째{" "}
                        {f.secondLargest.toLocaleString()} (RSF {f.rsf.toFixed(1)}배)
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-700">
                라운드트립(2자간 상계성 거래) 탐지
              </p>
              {!journalRows ? (
                <p className="mt-1 text-xs text-slate-400">
                  전표데이터가 없습니다. 위에서 업로드하면 계산됩니다.
                </p>
              ) : roundTripFlags.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">
                  같은 거래처에 매출과 매입이 유사 금액·근접 시점에 함께 잡히는
                  의심 거래가 없습니다.
                </p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {roundTripFlags.map((f, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs"
                    >
                      <p className="font-medium text-slate-700">
                        ⚠ 거래처: {f.counterparty} ({f.daysApart}일 간격)
                      </p>
                      <p className="mt-0.5 text-slate-600">
                        매출 {f.saleAmount.toLocaleString()}원 · {f.saleAccount}{" "}
                        ({f.saleDate}) ↔ 매입 {f.purchaseAmount.toLocaleString()}원
                        · {f.purchaseAccount} ({f.purchaseDate})
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "je" && (
          <div className="mt-3 space-y-4">
            <p className="text-xs text-slate-400">
              ISA 240(부정)에 따른 전표(JE) 부정위험 테스트입니다. 전표데이터를
              올리면 주말·심야 전기, 라운드넘버, 적요 공란, 작성자=승인자,
              결산일 임박 전기 등 표준 위험 기준으로 예외항목을 뽑아줍니다.
              여기서 표시되는 건 감사인이 추가로 확인할 대상이지, 부정 확정이
              아닙니다.
            </p>

            {journalUploadBox}

            {!journalRows ? (
              <p className="text-xs text-slate-400">
                전표데이터가 없습니다. 위에서 업로드하면 테스트가 실행됩니다.
              </p>
            ) : jeTestSummary ? (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="text-xs text-slate-500">
                      승인한도 (원, 선택)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={jeApprovalLimitInput}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/[^0-9]/g, "");
                        setJeApprovalLimitInput(
                          digits ? Number(digits).toLocaleString() : ""
                        );
                      }}
                      placeholder="예: 10,000,000"
                      className="mt-1 w-44 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>
                  <p className="text-[11px] leading-tight text-slate-400">
                    입력하면 한도 바로 아래 금액(분할 전기) 테스트가
                    추가됩니다.
                  </p>
                </div>

                <p className="text-xs text-slate-500">
                  전표 {jeTestSummary.totalRows.toLocaleString()}건 분석
                  {jeTestSummary.parsedDateCount < jeTestSummary.totalRows &&
                    ` · 날짜 인식 ${jeTestSummary.parsedDateCount.toLocaleString()}건(형식 오류分 제외)`}
                </p>

                <div className="space-y-2">
                  {jeTestSummary.results.map((test) => (
                    <div
                      key={test.key}
                      className={`rounded-lg border p-3 ${
                        test.flagCount > 0
                          ? "border-amber-200 bg-amber-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-900">
                          {test.flagCount > 0 && "⚠ "}
                          {test.label}
                        </p>
                        <span
                          className={`shrink-0 text-xs font-semibold ${
                            test.flagCount > 0
                              ? "text-amber-700"
                              : "text-slate-400"
                          }`}
                        >
                          {test.flagCount.toLocaleString()}건
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-tight text-slate-500">
                        {test.description}
                      </p>
                      {test.flags.length > 0 && (
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="text-slate-400">
                                <th className="px-1.5 py-1 text-left font-medium">
                                  전표번호
                                </th>
                                <th className="px-1.5 py-1 text-left font-medium">
                                  전기일자
                                </th>
                                <th className="px-1.5 py-1 text-left font-medium">
                                  계정
                                </th>
                                <th className="px-1.5 py-1 text-right font-medium">
                                  금액
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {test.flags.map((f, i) => (
                                <tr
                                  key={`${f.entryNo}-${i}`}
                                  className="border-t border-amber-100"
                                >
                                  <td className="px-1.5 py-1 text-slate-600">
                                    {f.entryNo}
                                  </td>
                                  <td className="px-1.5 py-1 text-slate-600">
                                    {f.date}
                                  </td>
                                  <td className="px-1.5 py-1 text-slate-600">
                                    {f.account}
                                  </td>
                                  <td className="px-1.5 py-1 text-right text-slate-700">
                                    {f.amount.toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {test.flagCount > test.flags.length && (
                            <p className="mt-1 text-[11px] text-slate-400">
                              … 외 {(test.flagCount - test.flags.length).toLocaleString()}건
                              (상위 {test.flags.length}건만 표시)
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold text-slate-900">
                    작성자별 전표 집중도 (상위 5명)
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {jeTestSummary.preparerConcentration.map((p) => (
                      <div key={p.name} className="text-xs">
                        <div className="flex justify-between text-slate-600">
                          <span>{p.name}</span>
                          <span>
                            {p.count.toLocaleString()}건 ({p.percent.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                          <div
                            className="h-1.5 rounded-full bg-blue-600"
                            style={{ width: `${Math.min(100, p.percent)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">
                    특정 작성자에게 전표가 과도하게 집중되면 통제·직무분리
                    측면을 검토합니다.
                  </p>
                </div>
              </>
            ) : null}
          </div>
        )}

        {activeTab === "tb" && (
          <div className="mt-3 space-y-4">
            <p className="text-xs text-slate-400">
              클라이언트 총계정원장에서 뽑은 시산표가 무결한지 먼저 검증합니다
              — 이후 모든 분석·표본추출은 이 시산표를 신뢰한다는 전제 위에서
              이뤄지기 때문입니다. 잔액은 차변 양수(+)·대변 음수(−)의
              부호형으로 입력하세요.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={downloadTrialBalanceTemplate}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                시산표 템플릿 다운로드
              </button>
              <button
                type="button"
                onClick={() => onAttachTrialBalance(SAMPLE_TRIAL_BALANCE)}
                className="text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                파일 없이 샘플 시산표로 체험하기 →
              </button>
            </div>

            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3">
              {trialBalanceRows ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-600">
                    시산표 {trialBalanceRows.length.toLocaleString()}개 계정이
                    연결되어 있습니다.
                  </p>
                  <label className="cursor-pointer text-xs font-medium text-blue-700 hover:text-blue-800">
                    다른 파일로 교체
                    <input
                      type="file"
                      accept=".xlsx"
                      onChange={handleTbFileChange}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                <>
                  <label className="flex cursor-pointer flex-col gap-1.5 text-xs">
                    <span className="font-medium text-slate-700">
                      시산표 업로드
                    </span>
                    <span className="text-slate-400">
                      &apos;시산표&apos; 시트 또는 첫 시트에
                      계정코드·계정과목·기초잔액·당기차변·당기대변·기말잔액
                      순서로 입력합니다.
                    </span>
                    <input
                      type="file"
                      accept=".xlsx"
                      onChange={handleTbFileChange}
                      className="mt-1 block text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                    />
                  </label>
                  {tbFileName && tbParsing && (
                    <p className="mt-1.5 text-xs text-slate-400">
                      {tbFileName} 읽는 중...
                    </p>
                  )}
                  {tbError && (
                    <p className="mt-1.5 text-xs text-red-600">{tbError}</p>
                  )}
                </>
              )}
            </div>

            {!trialBalanceRows ? (
              <p className="text-xs text-slate-400">
                시산표가 없습니다. 위에서 업로드하면 검증이 실행됩니다.
              </p>
            ) : tbCheck ? (
              <>
                <p className="text-xs text-slate-500">
                  시산표 {tbCheck.rowCount.toLocaleString()}개 계정 검증
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div
                    className={`rounded-lg border p-3 ${
                      tbCheck.isBalanced
                        ? "border-slate-200 bg-white"
                        : "border-red-200 bg-red-50"
                    }`}
                  >
                    <p className="text-xs font-semibold text-slate-900">
                      {tbCheck.isBalanced ? "✅ " : "⚠ "}차대변 균형 (기말잔액
                      합계)
                    </p>
                    <p
                      className={`mt-1 text-lg font-bold ${
                        tbCheck.isBalanced ? "text-slate-900" : "text-red-600"
                      }`}
                    >
                      {tbCheck.closingBalanceSum.toLocaleString()}원
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {tbCheck.isBalanced
                        ? "기말잔액 합계가 0 — 차변과 대변이 일치합니다."
                        : "0이 아닙니다. 이 금액만큼 차대변이 맞지 않습니다."}
                    </p>
                  </div>

                  <div
                    className={`rounded-lg border p-3 ${
                      tbCheck.periodActivityBalanced
                        ? "border-slate-200 bg-white"
                        : "border-red-200 bg-red-50"
                    }`}
                  >
                    <p className="text-xs font-semibold text-slate-900">
                      {tbCheck.periodActivityBalanced ? "✅ " : "⚠ "}당기 발생액
                      균형
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      차변 합계 {tbCheck.periodDebitTotal.toLocaleString()}원
                    </p>
                    <p className="text-xs text-slate-600">
                      대변 합계 {tbCheck.periodCreditTotal.toLocaleString()}원
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {tbCheck.periodActivityBalanced
                        ? "당기 차변·대변 발생액이 일치합니다."
                        : `차이 ${(tbCheck.periodDebitTotal - tbCheck.periodCreditTotal).toLocaleString()}원`}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-700">
                    계정별 roll-forward 검증 (기초 + 당기차변 − 당기대변 = 기말)
                  </p>
                  {tbCheck.rollForwardMismatches.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-500">
                      ✅ 모든 계정의 기초·증감·기말이 정합합니다.
                    </p>
                  ) : (
                    <div className="mt-2 overflow-x-auto rounded-lg border border-red-200">
                      <table className="w-full text-[11px]">
                        <thead className="bg-red-50">
                          <tr className="text-slate-500">
                            <th className="px-2 py-1.5 text-left font-medium">
                              계정코드
                            </th>
                            <th className="px-2 py-1.5 text-left font-medium">
                              계정과목
                            </th>
                            <th className="px-2 py-1.5 text-right font-medium">
                              기대 기말
                            </th>
                            <th className="px-2 py-1.5 text-right font-medium">
                              실제 기말
                            </th>
                            <th className="px-2 py-1.5 text-right font-medium">
                              차이
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {tbCheck.rollForwardMismatches
                            .slice(0, 50)
                            .map((m, i) => (
                              <tr
                                key={`${m.code}-${i}`}
                                className="border-t border-red-100"
                              >
                                <td className="px-2 py-1 text-slate-600">
                                  {m.code}
                                </td>
                                <td className="px-2 py-1 text-slate-600">
                                  {m.account}
                                </td>
                                <td className="px-2 py-1 text-right text-slate-600">
                                  {m.expected.toLocaleString()}
                                </td>
                                <td className="px-2 py-1 text-right text-slate-600">
                                  {m.closing.toLocaleString()}
                                </td>
                                <td className="px-2 py-1 text-right font-medium text-red-600">
                                  {m.diff.toLocaleString()}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {tbCheck.rollForwardMismatches.length > 50 && (
                        <p className="px-2 py-1.5 text-[11px] text-slate-400">
                          … 외 {(tbCheck.rollForwardMismatches.length - 50).toLocaleString()}건
                          (상위 50건만 표시)
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        )}

        {activeTab === "checklist" && (
          <div className="mt-3">
            <p className="text-xs text-slate-400">
              재무비율·이상탐지 모델·교차검증 결과를 근거로 감사 체크리스트
              초안을 생성합니다. 아래 결과는 AI가 생성한 초안이며, 최종 판단은
              감사인이 직접 내려야 합니다.
            </p>

            <button
              type="button"
              onClick={handleGenerateChecklist}
              disabled={checklistLoading}
              className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checklistLoading ? "체크리스트 생성 중..." : "감사 체크리스트 생성"}
            </button>

            {checklistError && (
              <p className="mt-2 text-xs text-red-600">{checklistError}</p>
            )}
            {checklist && checklist.length > 0 && (
              <div className="mt-3 space-y-2">
                {checklist.map((item, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-slate-200 bg-white p-3"
                  >
                    <p className="text-xs font-semibold text-slate-900">
                      ⚠ {item.risk}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {item.procedure}
                    </p>
                    {/* AI가 실재하지 않는 기준서를 인용하는 경우가 있어,
                        화이트리스트에 있는 인용만 기준서로 표시한다. */}
                    {formatIsaReferenceKo(item.isaReference) ? (
                      <button
                        type="button"
                        onClick={() => setOpenIsaReference(item.isaReference)}
                        className="mt-1 text-xs font-medium text-blue-700 underline decoration-dotted hover:text-blue-800"
                      >
                        {formatIsaReferenceKo(item.isaReference)}
                      </button>
                    ) : (
                      <p className="mt-1 text-xs text-slate-400">
                        근거 기준서 미확인 — 감사인이 직접 확인 필요
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "materiality" && (
          <div className="mt-3">
            <p className="text-xs text-slate-400">
              중요성은 감사의 출발점입니다. 어느 계정을 얼마나 파고들지,
              표본을 몇 개 뽑을지, 발견한 왜곡을 넘길지 말지가 모두 이
              금액에서 나옵니다. ISA 320에 따라 벤치마크와 적용률을 고르면
              전반중요성·수행중요성·명백히 사소한 기준을 산출합니다.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-slate-700">
                  벤치마크
                </label>
                <select
                  value={matBenchmark}
                  onChange={(e) =>
                    handleSelectBenchmark(e.target.value as BenchmarkKey)
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                >
                  {BENCHMARKS.map((b) => (
                    <option key={b.key} value={b.key}>
                      {b.label} ({b.minRate}~{b.maxRate}%)
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                  {matBenchmarkOption.guidance}
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">
                  벤치마크 금액 (원)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={
                    matAmountInput.trim() !== ""
                      ? matAmountInput
                      : matReadAmount != null
                        ? Math.round(matReadAmount).toLocaleString()
                        : ""
                  }
                  onChange={(e) =>
                    handleMusAmountInputChange(setMatAmountInput, e.target.value)
                  }
                  placeholder="재무제표에서 자동으로 읽습니다"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                  {matReadAmount == null
                    ? "재무제표에서 이 계정을 찾지 못했습니다. 금액을 직접 입력하세요."
                    : "재무제표에서 읽은 값입니다. 필요하면 직접 수정할 수 있습니다."}
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">
                  적용률 (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={matRateInput}
                  onChange={(e) => setMatRateInput(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                  실무 통용범위 {matBenchmarkOption.minRate}~
                  {matBenchmarkOption.maxRate}%
                  {matRateOutOfRange && (
                    <span className="text-amber-700">
                      {" "}
                      · 범위를 벗어났습니다. 조서에 근거를 남기세요.
                    </span>
                  )}
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">
                  평가된 위험 (수행중요성률)
                </label>
                <select
                  value={matRisk}
                  onChange={(e) => setMatRisk(e.target.value as RiskLevel)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                >
                  {(["normal", "high"] as const).map((k) => (
                    <option key={k} value={k}>
                      {PM_RATES[k].label} — 전반중요성의 {PM_RATES[k].rate}%
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                  {PM_RATES[matRisk].note}
                </p>
              </div>
            </div>

            {matBenchmarkIsLoss && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                선택한 벤치마크가 0 이하입니다(적자 또는 매출 없음). 이익·매출
                기준은 이 경우 중요성을 왜곡하므로, 자산총계나 자본총계 기준으로
                바꾸는 것을 검토하세요.
              </p>
            )}

            {materialityResult ? (
              <>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">전반중요성 (OM)</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                      {Math.round(materialityResult.overall).toLocaleString()}원
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      벤치마크 × {matRate}%
                    </p>
                  </div>
                  <div className="rounded-xl border-2 border-blue-600 bg-blue-50 p-4">
                    <p className="text-xs font-medium text-blue-800">
                      수행중요성 (PM)
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-blue-900">
                      {Math.round(
                        materialityResult.performance
                      ).toLocaleString()}
                      원
                    </p>
                    <p className="mt-1 text-[11px] text-blue-700">
                      전반중요성 × {materialityResult.pmRate}% · 실제 절차에
                      쓰는 값
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">
                      명백히 사소한 기준 (CTT)
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                      {Math.round(
                        materialityResult.clearlyTrivial
                      ).toLocaleString()}
                      원
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      전반중요성 × {CTT_RATE}% · 이하는 집계 제외
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleApplyMateriality}
                    className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 active:bg-blue-900"
                  >
                    수행중요성을 이상변동 필터·MUS에 적용
                  </button>
                  {materialityAmount > 0 && (
                    <span className="text-xs text-slate-500">
                      현재 적용값: {materialityAmount.toLocaleString()}원
                    </span>
                  )}
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold text-slate-700">
                    산출 근거 (조서 첨부용)
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    벤치마크: {matBenchmarkOption.label}{" "}
                    {Math.round(matAmount).toLocaleString()}원 · 적용률{" "}
                    {matRate}% → 전반중요성{" "}
                    {Math.round(materialityResult.overall).toLocaleString()}원.
                    평가된 위험 {PM_RATES[matRisk].label}에 따라 수행중요성은
                    전반중요성의 {materialityResult.pmRate}%인{" "}
                    {Math.round(
                      materialityResult.performance
                    ).toLocaleString()}
                    원으로 설정. 명백히 사소한 기준은{" "}
                    {Math.round(
                      materialityResult.clearlyTrivial
                    ).toLocaleString()}
                    원.
                  </p>
                </div>
              </>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
                벤치마크 금액과 적용률을 입력하면 중요성이 산출됩니다.
              </p>
            )}
          </div>
        )}

        {activeTab === "sum" && (
          <div className="mt-3">
            <p className="text-xs text-slate-400">
              개별로는 사소해 보이는 왜곡도 합치면 중요성을 넘을 수 있습니다.
              감사 중 발견한 왜곡을 여기에 모아 미수정분 합계를 전반중요성과
              비교합니다(ISA 450). 금액은 <b>세전이익에 미치는 영향</b>으로
              적되, 이익을 과대계상한 왜곡은 양수(+), 과소계상한 왜곡은
              음수(−)로 입력하세요.
            </p>

            {!materialityResult && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                먼저 <b>중요성 산정</b> 탭에서 중요성을 산출해야 합계를 판정할
                기준이 생깁니다.
              </p>
            )}

            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px_130px_auto] sm:items-end">
                <div>
                  <label className="text-xs font-medium text-slate-700">
                    왜곡 내용
                  </label>
                  <input
                    type="text"
                    value={sumDescInput}
                    onChange={(e) => setSumDescInput(e.target.value)}
                    placeholder="예: 기말 재고 과대계상 (수량 착오)"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">
                    유형
                  </label>
                  <select
                    value={sumTypeInput}
                    onChange={(e) =>
                      setSumTypeInput(e.target.value as MisstatementType)
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  >
                    {(
                      Object.keys(MISSTATEMENT_TYPE_LABELS) as MisstatementType[]
                    ).map((k) => (
                      <option key={k} value={k}>
                        {MISSTATEMENT_TYPE_LABELS[k].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">
                    세전이익 영향
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={sumAmountInput}
                    onChange={(e) => setSumAmountInput(e.target.value)}
                    placeholder="+1000000"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddMisstatement}
                  disabled={!sumDescInput.trim() || !sumAmountInput.trim()}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  추가
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">
                {MISSTATEMENT_TYPE_LABELS[sumTypeInput].note}
              </p>

              {tbCheck && tbCheck.rollForwardMismatches.length > 0 && (
                <button
                  type="button"
                  onClick={handleImportTbMismatches}
                  className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  시산표 roll-forward 불일치{" "}
                  {tbCheck.rollForwardMismatches.length}건 불러오기
                </button>
              )}
            </div>

            {/* 전표 예외항목을 왜곡으로 오해하지 않도록 명시한다. */}
            <p className="mt-2 text-[11px] leading-4 text-slate-400">
              ※ 전표(JE) 테스트의 예외항목은 자동으로 들어오지 않습니다.
              &quot;주말 전기&quot; 같은 신호는 조사 대상이지 확정된 왜곡금액이
              아니므로, 실제로 조사해 왜곡으로 확정한 건만 직접 추가하세요.
            </p>

            {misstatements.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
                아직 집계된 왜곡사항이 없습니다.
              </p>
            ) : (
              <>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 pr-3 font-medium">왜곡 내용</th>
                        <th className="py-2 pr-3 font-medium">유형</th>
                        <th className="py-2 pr-3 text-right font-medium">
                          세전이익 영향
                        </th>
                        <th className="py-2 pr-3 text-center font-medium">
                          수정됨
                        </th>
                        <th className="py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {misstatements.map((m) => {
                        const trivial =
                          materialityResult != null &&
                          Math.abs(m.incomeEffect) <
                            materialityResult.clearlyTrivial;
                        return (
                          <tr
                            key={m.id}
                            className={m.corrected ? "text-slate-400" : ""}
                          >
                            <td className="py-2 pr-3">
                              {m.description}
                              {trivial && !m.corrected && (
                                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                  CTT 미만
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-3">
                              {MISSTATEMENT_TYPE_LABELS[m.type].label}
                            </td>
                            <td
                              className={`py-2 pr-3 text-right tabular-nums ${
                                m.corrected
                                  ? ""
                                  : m.incomeEffect > 0
                                    ? "text-red-600"
                                    : "text-blue-700"
                              }`}
                            >
                              {m.incomeEffect > 0 ? "+" : ""}
                              {Math.round(m.incomeEffect).toLocaleString()}
                            </td>
                            <td className="py-2 pr-3 text-center">
                              <input
                                type="checkbox"
                                checked={m.corrected}
                                onChange={() => handleToggleCorrected(m.id)}
                                aria-label={`${m.description} 수정 여부`}
                                className="h-3.5 w-3.5 accent-blue-700"
                              />
                            </td>
                            <td className="py-2 text-right">
                              <button
                                type="button"
                                onClick={() => handleRemoveMisstatement(m.id)}
                                className="text-slate-400 hover:text-red-600"
                              >
                                삭제
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">
                      미수정 순합계 (상계 후)
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                      {misstatementSummary.netUncorrected > 0 ? "+" : ""}
                      {Math.round(
                        misstatementSummary.netUncorrected
                      ).toLocaleString()}
                      원
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      미수정 {misstatementSummary.uncorrectedCount}건
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">
                      미수정 총규모 (절대값)
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                      {Math.round(
                        misstatementSummary.grossUncorrected
                      ).toLocaleString()}
                      원
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      상계에 기대지 않은 총합
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">비교 기준</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                      {materialityResult
                        ? `${Math.round(materialityResult.overall).toLocaleString()}원`
                        : "—"}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      전반중요성 (OM)
                    </p>
                  </div>
                </div>

                {materialityResult && (
                  <div
                    className={`mt-4 rounded-lg border px-4 py-3 ${
                      misstatementSummary.exceedsOverall ||
                      misstatementSummary.hasIndividuallyMaterial
                        ? "border-red-200 bg-red-50"
                        : "border-emerald-200 bg-emerald-50"
                    }`}
                  >
                    <p
                      className={`text-xs font-semibold ${
                        misstatementSummary.exceedsOverall ||
                        misstatementSummary.hasIndividuallyMaterial
                          ? "text-red-800"
                          : "text-emerald-800"
                      }`}
                    >
                      {misstatementSummary.exceedsOverall
                        ? "미수정 왜곡의 합계가 전반중요성을 초과합니다"
                        : misstatementSummary.hasIndividuallyMaterial
                          ? "개별적으로 전반중요성을 초과하는 왜곡이 있습니다"
                          : "미수정 왜곡의 합계가 전반중요성 이내입니다"}
                    </p>
                    <p
                      className={`mt-1 text-xs leading-5 ${
                        misstatementSummary.exceedsOverall ||
                        misstatementSummary.hasIndividuallyMaterial
                          ? "text-red-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {misstatementSummary.exceedsOverall ||
                      misstatementSummary.hasIndividuallyMaterial
                        ? "경영진에게 수정을 요구하고, 수정되지 않으면 감사의견에 미치는 영향을 검토해야 합니다."
                        : "다만 질적 요인(추세 반전, 약정 위반, 경영진 보상 관련 등)은 금액과 무관하게 중요할 수 있으므로 별도로 판단하세요."}
                      {misstatementSummary.belowThresholdCount > 0 &&
                        ` 명백히 사소한 기준(CTT) 미만 ${misstatementSummary.belowThresholdCount}건이 포함돼 있습니다 — 집계에서 제외할 수 있습니다.`}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "mus" && (
          <div className="mt-3">
            <p className="text-xs text-slate-400">
              MUS는 재무제표 전체가 아니라 재고자산·매출채권처럼 실증절차
              대상이 되는 개별 계정 잔액 하나를 모집단으로 삼아 계산합니다.
              아래에서 계정을 선택하면 그 계정의 당기 잔액이 모집단 총액에
              자동으로 채워집니다. 자산총계·자본금·당기순이익처럼 여러 상세
              계정의 합계이거나 실물 확인 대상 거래가 없는 계정은 실사가
              불가능해 선택 목록에서 제외했습니다.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-slate-500">신뢰수준</label>
                <select
                  value={musConfidenceLevel}
                  onChange={(e) =>
                    setMusConfidenceLevel(
                      Number(e.target.value) as MusConfidenceLevel
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                >
                  <option value={90}>90%</option>
                  <option value={95}>95%</option>
                  <option value={99}>99%</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-500">
                  예상오류율 (%, 선택)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={musExpectedRateInput}
                  onChange={(e) => setMusExpectedRateInput(e.target.value)}
                  placeholder="예: 0.5"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs text-slate-500">
                  계정 선택 (모집단 자동입력)
                </label>
                <select
                  defaultValue=""
                  onChange={(e) => handleMusSelectAccount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                >
                  <option value="">직접 입력 또는 계정 선택...</option>
                  {(["재무상태표", "손익계산서"] as const).map((stmt) => (
                    <optgroup key={stmt} label={stmt}>
                      {musAccountOptions
                        .filter((r) => r.stmt === stmt)
                        .map((r) => (
                          <option
                            key={`${stmt}::${r.account}`}
                            value={`${stmt}::${r.account}`}
                          >
                            {r.account} ({Math.round(r.current).toLocaleString()}원)
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-500">
                  모집단 총액 (원)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={musPopulationInput}
                  onChange={(e) =>
                    handleMusAmountInputChange(
                      setMusPopulationInput,
                      e.target.value
                    )
                  }
                  placeholder="예: 42,081,734,000,000"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="text-xs text-slate-500">
                  허용왜곡금액 (원)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={musTolerableInput}
                  onChange={(e) =>
                    handleMusAmountInputChange(
                      setMusTolerableInput,
                      e.target.value
                    )
                  }
                  placeholder="예: 1,000,000,000"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
            </div>

            {musPopulationAmount > 0 && musTolerableMisstatement > 0 ? (
              musResult ? (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold text-slate-900">
                        표본크기
                      </p>
                      <p className="mt-1 text-lg font-bold text-slate-900">
                        {musResult.sampleSize.toLocaleString()}건
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        신뢰요소 {musResult.reliabilityFactor} (신뢰수준{" "}
                        {musConfidenceLevel}%)
                        {musExpectedMisstatementRate > 0 &&
                          ` · 확장계수 ${musResult.expansionFactor}`}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold text-slate-900">
                        표본추출 간격
                      </p>
                      <p className="mt-1 text-lg font-bold text-slate-900">
                        {Math.round(
                          musResult.samplingInterval
                        ).toLocaleString()}
                        원
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        모집단 총액 ÷ 표본크기
                      </p>
                    </div>
                  </div>

                  {musExpectedMisstatementRate > 0 && (
                    <p className="text-xs text-slate-500">
                      조정 허용왜곡금액 ={" "}
                      {Math.round(
                        musResult.adjustedTolerableMisstatement
                      ).toLocaleString()}
                      원 (허용왜곡금액 − 예상오류금액{" "}
                      {Math.round(
                        musResult.expectedMisstatementAmount
                      ).toLocaleString()}
                      원 × 확장계수 {musResult.expansionFactor})
                    </p>
                  )}

                  <div>
                    <p className="text-xs font-semibold text-slate-700">
                      계통추출 표본항목 (누적 금액 태그)
                      {musResult.isCappedPreview &&
                        ` — 상위 ${musResult.sampleTags.length}건만 표시`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {musResult.sampleTags.map((tag, i) => (
                        <span
                          key={i}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                        >
                          {tag.toLocaleString()}원
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      각 태그가 속한 계정·거래(누적 금액 기준 위치)를 표본으로
                      선정합니다. 실제 모집단 항목 목록에 누적금액을
                      매핑해야 최종 표본이 확정됩니다.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-red-600">
                  허용왜곡금액이 예상오류금액(확장 반영)보다 작아 표본크기를
                  산출할 수 없습니다. 허용왜곡금액을 높이거나 예상오류율을
                  낮춰주세요.
                </p>
              )
            ) : (
              <p className="mt-3 text-xs text-slate-400">
                모집단 총액과 허용왜곡금액을 입력하면 표본크기가 계산됩니다.
              </p>
            )}
          </div>
        )}

        {activeTab === "dashboard" && (
          <div className="mt-3 space-y-6">
            <div>
              <p className="text-xs font-semibold text-slate-700">
                전기 대비 이상 변동 계정 (상위 {abnormalChartData.length}건)
              </p>
              {abnormalChartData.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">
                  이상 변동으로 표시된 계정이 없습니다.
                </p>
              ) : (
                <div className="mt-2 h-72 rounded-lg border border-slate-200 bg-white p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={abnormalChartData}
                      layout="vertical"
                      margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                      barCategoryGap={10}
                    >
                      <CartesianGrid
                        stroke="#e2e8f0"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickFormatter={(v) => v.toLocaleString()}
                      />
                      <YAxis
                        type="category"
                        dataKey="account"
                        width={110}
                        tick={{ fontSize: 11, fill: "#334155" }}
                      />
                      <Tooltip
                        formatter={(v) => Number(v).toLocaleString()}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        dataKey="전기"
                        fill="#eb6834"
                        radius={[0, 4, 4, 0]}
                        maxBarSize={18}
                      />
                      <Bar
                        dataKey="당기"
                        fill="#2a78d6"
                        radius={[0, 4, 4, 0]}
                        maxBarSize={18}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="mt-1 text-[11px] text-slate-400">
                    단위: {amountUnitLabel(unit)}
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-900">
                  Beneish M-Score
                </p>
                {beneishResult ? (
                  <>
                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {beneishResult.score.toFixed(2)}
                    </p>
                    <div className="relative mt-2 h-2 rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${Math.min(100, Math.max(0, ((beneishResult.score - -5) / (1 - -5)) * 100))}%`,
                          backgroundColor: beneishResult.isSuspicious
                            ? "#d03b3b"
                            : "#0ca30c",
                        }}
                      />
                      <div
                        className="absolute top-0 h-2 w-px bg-slate-400"
                        style={{
                          left: `${((-1.78 - -5) / (1 - -5)) * 100}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      기준치 −1.78 (회색 선) ·{" "}
                      {beneishResult.isSuspicious
                        ? "이익조작 가능성 높음"
                        : "정상 범위"}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">데이터 부족</p>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-900">
                  Altman Z&apos;-Score
                </p>
                {altmanResult ? (
                  <>
                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {altmanResult.score.toFixed(2)}
                    </p>
                    <div className="relative mt-2 h-2 rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${Math.min(100, Math.max(0, (altmanResult.score / 5) * 100))}%`,
                          backgroundColor:
                            altmanResult.zone === "safe"
                              ? "#0ca30c"
                              : altmanResult.zone === "grey"
                                ? "#fab219"
                                : "#d03b3b",
                        }}
                      />
                      <div
                        className="absolute top-0 h-2 w-px bg-slate-400"
                        style={{ left: `${(1.23 / 5) * 100}%` }}
                      />
                      <div
                        className="absolute top-0 h-2 w-px bg-slate-400"
                        style={{ left: `${(2.9 / 5) * 100}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      기준선 1.23 · 2.9 (회색 선) ·{" "}
                      {altmanResult.zone === "safe" && "안전지대"}
                      {altmanResult.zone === "grey" && "회색지대"}
                      {altmanResult.zone === "distress" && "위험지대"}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">데이터 부족</p>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-700">
                Benford&apos;s Law — 실제 vs 기대 분포
              </p>
              {benfordChartData.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">
                  전표데이터가 없어 계산할 수 없습니다.
                </p>
              ) : (
                <div className="mt-2 h-64 rounded-lg border border-slate-200 bg-white p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={benfordChartData}
                      margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
                    >
                      <CartesianGrid stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="digit"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        formatter={(v) => `${v}%`}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        dataKey="실제"
                        fill="#2a78d6"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={22}
                      />
                      <Bar
                        dataKey="기대"
                        fill="#eb6834"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={22}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 pt-4">
              <p className="text-xs font-semibold text-slate-700">
                분석적검토 조서 export (초안)
              </p>
              <p className="mt-1 text-xs text-slate-400">
                조서번호·대상기간·중요성 기준·작성자/검토자 사인란·결론·tickmark
                범례를 갖춘 분석적검토 조서(초안) 형태로 내보냅니다 — 재무비율·
                이상변동계정·이상탐지 모델·(생성된 경우) 감사 체크리스트 포함.
                Word는 검색·편집이 가능해 감사인이 결론·서명을 채워 조서로
                확정하는 용도이고, PDF는 시각 스냅샷입니다. 브라우저에서 바로
                생성·다운로드되며 서버에 저장되지 않습니다.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={pdfExporting}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pdfExporting ? "PDF 생성 중..." : "PDF로 내보내기"}
                </button>
                <button
                  type="button"
                  onClick={handleExportWord}
                  disabled={wordExporting}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {wordExporting ? "Word 생성 중..." : "Word로 내보내기"}
                </button>
              </div>
              {exportError && (
                <p className="mt-2 text-xs text-red-600">{exportError}</p>
              )}
            </div>
          </div>
        )}

        {activeTab === "disclosure" && corpCode && (
          <div className="mt-3">
            <p className="text-xs text-slate-400">
              최근 1년간 DART 공시 목록을 AI로 검토해 주의가 필요한 공시를
              표시합니다. 아래 결과는 AI가 생성한 초안이며, 최종 판단은
              감사인이 직접 내려야 합니다.
            </p>

            <button
              type="button"
              onClick={handleSummarizeDisclosures}
              disabled={disclosureLoading}
              className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {disclosureLoading ? (
                <LoadingDots text="공시 조회 중" />
              ) : (
                "최근 공시 AI 요약"
              )}
            </button>

            {disclosureError && (
              <p className="mt-2 text-xs text-red-600">{disclosureError}</p>
            )}
            {disclosureItems &&
              (disclosureItems.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">
                  최근 1년간 공시 내역이 없습니다.
                </p>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {disclosureItems.map((item, i) => (
                    <a
                      key={i}
                      href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.receiptNo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`block rounded-lg border p-2.5 text-xs hover:brightness-95 ${
                        item.isIssue
                          ? "border-amber-200 bg-amber-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <p className="font-medium text-slate-700">
                        {item.isIssue && "⚠ "}
                        {item.reportName}
                        <span className="ml-2 font-normal text-slate-400">
                          {item.receiptDate}
                        </span>
                        <span className="ml-2 text-blue-700">
                          DART 원문 보기 ↗
                        </span>
                      </p>
                      {item.note && (
                        <p className="mt-0.5 text-slate-600">{item.note}</p>
                      )}
                    </a>
                  ))}
                </div>
              ))}
          </div>
        )}
      </div>

      {openStatement === "bs" && (
        <StatementModal
          title="재무상태표"
          changes={bsChanges}
          unit={unit}
          layout="t-account"
          onClose={() => setOpenStatement(null)}
        />
      )}
      {openStatement === "is" && (
        <StatementModal
          title="손익계산서"
          changes={isChanges}
          unit={unit}
          onClose={() => setOpenStatement(null)}
        />
      )}
      {openIsaReference && (
        <IsaStandardModal
          reference={openIsaReference}
          onClose={() => setOpenIsaReference(null)}
        />
      )}
    </div>
  );
}

const AUDIT_EVENT_LABELS: Record<string, string> = {
  created: "분석 요청 생성",
  loaded: "재무제표 불러옴",
  report_exported: "리포트 export",
  checklist_generated: "AI 체크리스트 생성",
  disclosure_summarized: "공시 요약",
  deleted: "삭제",
};

/** 서버에 append-only로 남는 감사 이벤트를 시간순으로 보여준다. 서버 백엔드가
 * 켜져 있을 때만 의미 있는 데이터가 들어온다(불변 감사증적). */
function AuditTrail({
  sessionId,
  requestId,
}: {
  sessionId: string;
  requestId: string;
}) {
  const [events, setEvents] = useState<ServerAuditEvent[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const ev = await fetchServerEvents(sessionId, requestId);
      if (!cancelled) {
        setEvents(ev);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, requestId]);

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-700">
        감사증적 (append-only · 서버 불변 기록)
      </p>
      {loading ? (
        <p className="mt-1 text-xs text-slate-400">
          <LoadingDots text="불러오는 중" />
        </p>
      ) : !events || events.length === 0 ? (
        <p className="mt-1 text-xs text-slate-400">
          기록된 이벤트가 없습니다.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <span className="text-slate-700">
                {AUDIT_EVENT_LABELS[e.event_type] ?? e.event_type}
                {e.detail && typeof e.detail.format === "string"
                  ? ` (${e.detail.format.toUpperCase()})`
                  : ""}
              </span>
              <span className="tabular-nums text-slate-400">
                {new Date(e.occurred_at).toLocaleString("ko-KR")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Home() {
  const [activeSection, setActiveSection] = useState<
    "features" | "demo" | "chatbot"
  >("features");
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoveredMenuItem, setHoveredMenuItem] = useState<
    "features" | "demo" | null
  >(null);
  // 하위 메뉴 위치. 메뉴 자체가 화면 오른쪽 끝에 붙어있어서, 그냥
  // "오른쪽으로 펼치기"만 쓰면 화면이 좁을 때 화면 밖으로 잘려나가고,
  // 그렇다고 "왼쪽으로만 펼치기"를 쓰면 트리거 바로 옆(오른쪽)에 펼쳐지는
  // 원래 모양이 안 나온다. 그래서 기본은 트리거 오른쪽에 붙이되, 화면
  // 오른쪽 끝을 넘어가는 만큼만 안쪽으로 당겨서 항상 화면 안에 보이게 한다.
  const [submenuPos, setSubmenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const SUBMENU_MARGIN = 8;
  const handleMenuItemHover = (
    item: "features" | "demo",
    e: React.MouseEvent<HTMLDivElement>,
    width: number
  ) => {
    setHoveredMenuItem(item);
    const rect = e.currentTarget.getBoundingClientRect();
    const desiredLeft = rect.right + SUBMENU_MARGIN;
    const maxLeft = window.innerWidth - width - SUBMENU_MARGIN;
    setSubmenuPos({
      top: rect.top,
      left: Math.max(SUBMENU_MARGIN, Math.min(desiredLeft, maxLeft)),
    });
  };

  // 메뉴/버튼에서 특정 섹션으로 이동할 때 쓰는 스크롤 신호.
  // activeSection 값 자체는 이미 같은 섹션이라 안 바뀔 수 있어(예: 이미 "features"인데
  // 다른 기능 카드를 또 클릭) state 변화만으로는 재실행을 보장할 수 없다. 그래서
  // { id, nonce }로 매 클릭마다 강제로 새 값을 만들어 effect가 항상 실행되게 한다.
  const [scrollRequest, setScrollRequest] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const goToSection = (id: string) =>
    setScrollRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));

  useEffect(() => {
    if (!scrollRequest) return;
    const el = document.getElementById(scrollRequest.id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollRequest]);

  const [inputMode, setInputMode] = useState<"dart" | "excel" | "upstage">(
    "dart"
  );

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CorpSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // 브라우저 내장 음성인식(Web Speech API)은 서버에서 렌더링되지 않으므로
  // 마운트 후에만 지원 여부를 확인해 버튼을 표시한다(SSR과의 불일치 방지).
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setVoiceSupported(!!SpeechRecognitionCtor);
  }, []);

  function handleVoiceSearch() {
    const SpeechRecognitionCtor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "ko-KR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setQuery(transcript.trim());
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  const [selectedCorp, setSelectedCorp] = useState<CorpSearchResult | null>(
    null
  );
  const [bsnsYear, setBsnsYear] = useState("2025");
  const [reprtCode, setReprtCode] = useState("11011");
  const [fsDiv, setFsDiv] = useState<"OFS" | "CFS">("OFS");
  const [dartFinancials, setDartFinancials] =
    useState<NormalizedFinancials | null>(null);
  const [dartFetching, setDartFetching] = useState(false);
  const [dartFetchError, setDartFetchError] = useState<string | null>(null);

  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(
    null
  );
  const [trailRequestId, setTrailRequestId] = useState<string | null>(null);

  const [excelCompanyName, setExcelCompanyName] = useState("");
  const [excelFileName, setExcelFileName] = useState<string | null>(null);
  const [excelParsed, setExcelParsed] = useState<ParsedFinancials | null>(
    null
  );
  const [excelParsing, setExcelParsing] = useState(false);
  const [excelError, setExcelError] = useState<string | null>(null);

  const [upstageCompanyName, setUpstageCompanyName] = useState("");
  const [upstageFileName, setUpstageFileName] = useState<string | null>(null);
  const [upstageHighlights, setUpstageHighlights] =
    useState<FinancialHighlights | null>(null);
  const [upstageLoading, setUpstageLoading] = useState(false);
  const [upstageError, setUpstageError] = useState<string | null>(null);

  const [requests, setRequests] = useState<AnalysisRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  // 서버 백엔드(Supabase) 활성 여부. 활성이면 서버가 요청 목록의 원본(source of
  // truth)이 되고 감사증적이 서버에 불변으로 남는다. 미구성이면 localStorage 폴백.
  const [backendConfigured, setBackendConfigured] = useState(false);
  const sessionIdRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sid = getSessionId();
      sessionIdRef.current = sid;
      // 서버 백엔드가 켜져 있으면 서버 목록을 원본으로 사용한다.
      const { configured, requests: serverRequests } =
        await fetchServerRequests(sid);
      if (cancelled) return;
      if (configured) {
        setBackendConfigured(true);
        setRequests(
          serverRequests.map((r) => ({
            id: r.id,
            companyName: r.company_name,
            source: r.source,
            corpCode: r.corp_code ?? undefined,
            stockCode: r.stock_code ?? undefined,
            excelSummary: r.excel_summary ?? undefined,
            financials: r.financials ?? undefined,
            createdAt: new Date(r.created_at).toLocaleString("ko-KR"),
          }))
        );
      } else {
        // 폴백: localStorage
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw) setRequests(JSON.parse(raw));
        } catch {
          // 접근 불가 환경이면 빈 목록으로 시작
        }
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    // 서버 백엔드가 원본이면 localStorage에 요청 목록을 중복 저장하지 않는다.
    if (backendConfigured) return;
    // 폴백 모드: 기밀성상 거래 단위 원장(전표)·시산표는 localStorage에 남기지
    // 않고(메모리에만 유지), journalRows·trialBalanceRows를 떼어낸 요약본만 기록.
    const persistable = requests.map((r) => {
      const copy = { ...r };
      delete copy.journalRows;
      delete copy.trialBalanceRows;
      return copy;
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  }, [requests, loaded, backendConfigured]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/dart/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "검색 중 오류가 발생했습니다.");
        }
        setResults(data.results ?? []);
        setSearchError(null);
      } catch (err) {
        setResults([]);
        setSearchError(
          err instanceof Error ? err.message : "검색 중 오류가 발생했습니다."
        );
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query]);

  function handleSelect(corp: CorpSearchResult) {
    setSelectedCorp(corp);
    setDartFinancials(null);
    setDartFetchError(null);
    setQuery("");
    setResults([]);
  }

  async function handleFetchDartFinancials() {
    if (!selectedCorp) return;
    setDartFetching(true);
    setDartFetchError(null);
    setDartFinancials(null);
    try {
      const params = new URLSearchParams({
        corp_code: selectedCorp.corp_code,
        bsns_year: bsnsYear,
        reprt_code: reprtCode,
        fs_div: fsDiv,
      });
      const res = await fetch(`/api/dart/financials?${params}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "재무제표를 불러오는 중 오류가 발생했습니다.");
      }
      setDartFinancials(data.financials);
      // 별도의 "분석 요청에 추가" 클릭 없이, 불러온 즉시 분석 요청을 만들어
      // 자동으로 펼쳐 보여준다. 같은 기업(corpCode)을 다시 불러오면 기존 항목을
      // 갱신(대체)해 목록이 중복으로 쌓이지 않게 한다.
      await showDartAnalysis(data.financials, selectedCorp);
    } catch (err) {
      setDartFetchError(
        err instanceof Error
          ? err.message
          : "재무제표를 불러오는 중 오류가 발생했습니다."
      );
    } finally {
      setDartFetching(false);
    }
  }

  async function showDartAnalysis(
    financials: NormalizedFinancials,
    corp: CorpSearchResult
  ) {
    let id = crypto.randomUUID();
    // 서버 백엔드가 켜져 있으면 서버가 id를 부여하고 'created' 감사 이벤트를 남긴다.
    if (backendConfigured) {
      const saved = await createServerRequest({
        session_id: sessionIdRef.current,
        company_name: corp.corp_name,
        source: "dart",
        corp_code: corp.corp_code,
        stock_code: corp.stock_code,
        financials,
      });
      if (saved) id = saved.id;
    }
    const newRequest: AnalysisRequest = {
      id,
      companyName: corp.corp_name,
      source: "dart",
      corpCode: corp.corp_code,
      stockCode: corp.stock_code,
      financials,
      createdAt: new Date().toLocaleString("ko-KR"),
    };
    setRequests((prev) => [
      newRequest,
      ...prev.filter(
        (r) => !(r.source === "dart" && r.corpCode === corp.corp_code)
      ),
    ]);
    setExpandedRequestId(id);
  }

  async function handleExcelFileChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file) return;

    setExcelFileName(file.name);
    setExcelParsed(null);
    setExcelError(null);
    setExcelParsing(true);
    try {
      const parsed = await parseFinancialTemplate(file);
      if (parsed.missingSheets.length > 0) {
        throw new Error(
          `표준 템플릿과 시트 구성이 다릅니다 (누락: ${parsed.missingSheets.join(", ")})`
        );
      }
      setExcelParsed(parsed);
    } catch (err) {
      setExcelParsed(null);
      setExcelError(
        err instanceof Error ? err.message : "엑셀 파일을 읽는 중 오류가 발생했습니다."
      );
    } finally {
      setExcelParsing(false);
    }
  }

  // 파일 없이 바로 체험할 수 있도록 미리 만들어 둔 샘플 데이터를 파일
  // 업로드와 똑같은 상태로 채운다. 회사명·인식 결과가 즉시 채워지므로
  // 사용자는 "분석 요청에 추가"만 누르면 된다.
  function handleLoadSampleExcel() {
    setExcelCompanyName(SAMPLE_COMPANY_NAME);
    setExcelFileName("샘플 데이터 (파일 없음)");
    setExcelError(null);
    setExcelParsed(SAMPLE_EXCEL_PARSED);
  }

  async function handleAddExcelRequest() {
    const name = excelCompanyName.trim();
    if (!name || !excelParsed) return;

    const summary = Object.entries(excelParsed.sheets)
      .map(([sheet, rows]) => `${sheet} ${rows.length}건`)
      .concat(`전표데이터 ${excelParsed.journalRowCount}건`)
      .join(" · ");

    const toRows = (sheet?: { 계정과목: string; 전기: number; 당기: number }[]): StatementRow[] =>
      (sheet ?? []).map((r) => ({
        account: r.계정과목,
        prior: r.전기,
        current: r.당기,
      }));

    const financials: NormalizedFinancials = {
      bs: toRows(excelParsed.sheets["재무상태표"]),
      is: toRows(excelParsed.sheets["손익계산서"]),
      cf: toRows(excelParsed.sheets["현금흐름표"]),
    };

    let id = crypto.randomUUID();
    // 서버 저장(전표·시산표 원본은 기밀이라 제외하고 요약 재무제표만 전송)
    if (backendConfigured) {
      const saved = await createServerRequest({
        session_id: sessionIdRef.current,
        company_name: name,
        source: "excel",
        excel_summary: summary,
        financials,
      });
      if (saved) id = saved.id;
    }
    const newRequest: AnalysisRequest = {
      id,
      companyName: name,
      source: "excel",
      excelSummary: summary,
      financials,
      journalRows: excelParsed.journalRows,
      createdAt: new Date().toLocaleString("ko-KR"),
    };
    setRequests((prev) => [newRequest, ...prev]);
    setExcelCompanyName("");
    setExcelFileName(null);
    setExcelParsed(null);
    setExcelError(null);
  }

  async function handleUpstageFileChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file) return;

    // 기밀성: 업로드 파일(비상장 고객 재무제표일 수 있음)이 외부 AI(Upstage)로
    // 전송되므로 사전 동의 확인. 미동의 시 파일 선택을 취소한다.
    if (!ensureThirdPartyAiConsent()) {
      e.target.value = "";
      return;
    }

    setUpstageFileName(file.name);
    setUpstageHighlights(null);
    setUpstageError(null);
    setUpstageLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upstage/extract", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "인식 중 오류가 발생했습니다.");
      }
      setUpstageHighlights(data.highlights);
      if (data.highlights?.company_name) {
        setUpstageCompanyName(data.highlights.company_name);
      }
    } catch (err) {
      setUpstageError(
        err instanceof Error ? err.message : "인식 중 오류가 발생했습니다."
      );
    } finally {
      setUpstageLoading(false);
    }
  }

  async function handleAddUpstageRequest() {
    const name = upstageCompanyName.trim();
    if (!name || !upstageHighlights) return;

    const summary = [
      upstageHighlights.자산총계_당기 != null &&
        `자산총계 ${upstageHighlights.자산총계_당기.toLocaleString()}`,
      upstageHighlights.매출액_당기 != null &&
        `매출액 ${upstageHighlights.매출액_당기.toLocaleString()}`,
      upstageHighlights.당기순이익_당기 != null &&
        `당기순이익 ${upstageHighlights.당기순이익_당기.toLocaleString()}`,
    ]
      .filter(Boolean)
      .join(" · ");

    const h = upstageHighlights;
    const financials: NormalizedFinancials = {
      bs: [
        { account: "자산총계", prior: h.자산총계_전기 ?? 0, current: h.자산총계_당기 ?? 0 },
        { account: "부채총계", prior: h.부채총계_전기 ?? 0, current: h.부채총계_당기 ?? 0 },
        { account: "자본총계", prior: h.자본총계_전기 ?? 0, current: h.자본총계_당기 ?? 0 },
      ],
      is: [
        { account: "매출액", prior: h.매출액_전기 ?? 0, current: h.매출액_당기 ?? 0 },
        { account: "매출원가", prior: h.매출원가_전기 ?? 0, current: h.매출원가_당기 ?? 0 },
        { account: "판매비와관리비", prior: h.판매비와관리비_전기 ?? 0, current: h.판매비와관리비_당기 ?? 0 },
        { account: "영업이익", prior: h.영업이익_전기 ?? 0, current: h.영업이익_당기 ?? 0 },
        { account: "영업외수익", prior: h.영업외수익_전기 ?? 0, current: h.영업외수익_당기 ?? 0 },
        { account: "영업외비용", prior: h.영업외비용_전기 ?? 0, current: h.영업외비용_당기 ?? 0 },
        { account: "법인세비용", prior: h.법인세비용_전기 ?? 0, current: h.법인세비용_당기 ?? 0 },
        { account: "당기순이익", prior: h.당기순이익_전기 ?? 0, current: h.당기순이익_당기 ?? 0 },
      ],
    };

    let id = crypto.randomUUID();
    if (backendConfigured) {
      const saved = await createServerRequest({
        session_id: sessionIdRef.current,
        company_name: name,
        source: "upstage",
        excel_summary: summary || "Upstage AI 자동 인식 결과",
        financials,
      });
      if (saved) id = saved.id;
    }
    const newRequest: AnalysisRequest = {
      id,
      companyName: name,
      source: "upstage",
      excelSummary: summary || "Upstage AI 자동 인식 결과",
      financials,
      createdAt: new Date().toLocaleString("ko-KR"),
    };
    setRequests((prev) => [newRequest, ...prev]);
    setUpstageCompanyName("");
    setUpstageFileName(null);
    setUpstageHighlights(null);
    setUpstageError(null);
  }

  function handleDelete(id: string) {
    // 서버 모드: soft delete + 'deleted' 감사 이벤트(증적 보존). 화면에서만 제거.
    if (backendConfigured) {
      void deleteServerRequest(sessionIdRef.current, id);
    }
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  function handleAttachJournalRows(id: string, journalRows: JournalRow[]) {
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, journalRows } : r))
    );
  }

  function handleAttachTrialBalance(
    id: string,
    trialBalanceRows: TrialBalanceRow[]
  ) {
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, trialBalanceRows } : r))
    );
  }

  function handleClearAll() {
    if (backendConfigured) {
      const sid = sessionIdRef.current;
      requests.forEach((r) => void deleteServerRequest(sid, r.id));
    }
    setRequests([]);
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <header className="border-b border-slate-200 bg-[#f4f7fc]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => {
              setActiveSection("features");
              setExpandedFeature(null);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="flex items-center gap-3 border-0 bg-transparent p-0 transition-opacity hover:opacity-80"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-700 text-sm font-bold text-white">
              AI
            </div>
            <span className="text-base font-semibold tracking-tight text-slate-900">
              회계감사 AI 분석도구
            </span>
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="메뉴 열기"
              className="inline-flex h-14 w-24 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-500"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-9 w-9"
              >
                <path d="M4 6h16" />
                <path d="M4 12h16" />
                <path d="M4 18h16" />
              </svg>
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 z-20 mt-2 w-48 overflow-visible rounded-lg border border-slate-200 bg-white shadow-lg">
                  <div
                    className="relative"
                    onMouseEnter={(e) => handleMenuItemHover("features", e, 256)}
                    onMouseLeave={() => setHoveredMenuItem(null)}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSection("features");
                        setExpandedFeature(null);
                        setMenuOpen(false);
                        goToSection("features");
                      }}
                      className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${
                        activeSection === "features"
                          ? "font-semibold text-blue-700"
                          : "text-slate-700"
                      }`}
                    >
                      핵심 기능
                    </button>

                    <div
                      style={
                        submenuPos
                          ? { top: submenuPos.top, left: submenuPos.left }
                          : undefined
                      }
                      className={`fixed w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg transition-opacity duration-300 ease-out ${
                        hoveredMenuItem === "features"
                          ? "visible opacity-100"
                          : "invisible opacity-0"
                      }`}
                    >
                      {FEATURES.map((f) => (
                        <button
                          key={f.title}
                          type="button"
                          onClick={() => {
                            setActiveSection("features");
                            setExpandedFeature(f.title);
                            setMenuOpen(false);
                            goToSection("features");
                          }}
                          className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <p className="text-sm font-semibold text-slate-900">
                            {f.title}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div
                    className="relative"
                    onMouseEnter={(e) => handleMenuItemHover("demo", e, 240)}
                    onMouseLeave={() => setHoveredMenuItem(null)}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSection("demo");
                        setMenuOpen(false);
                        goToSection("demo");
                      }}
                      className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${
                        activeSection === "demo"
                          ? "font-semibold text-blue-700"
                          : "text-slate-700"
                      }`}
                    >
                      분석 체험하기
                    </button>

                    <div
                      style={
                        submenuPos
                          ? { top: submenuPos.top, left: submenuPos.left }
                          : undefined
                      }
                      className={`fixed w-60 rounded-lg border border-slate-200 bg-white p-2 shadow-lg transition-opacity duration-300 ease-out ${
                        hoveredMenuItem === "demo"
                          ? "visible opacity-100"
                          : "invisible opacity-0"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveSection("demo");
                          setInputMode("dart");
                          setMenuOpen(false);
                          goToSection("demo");
                        }}
                        className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
                      >
                        상장기업 검색
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveSection("demo");
                          setInputMode("excel");
                          setMenuOpen(false);
                          goToSection("demo");
                        }}
                        className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
                      >
                        비상장기업 엑셀 업로드
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveSection("demo");
                          setInputMode("upstage");
                          setMenuOpen(false);
                          goToSection("demo");
                        }}
                        className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
                      >
                        재무제표 이미지/PDF 자동인식
                      </button>
                    </div>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSection("chatbot");
                        setMenuOpen(false);
                        goToSection("chatbot");
                      }}
                      className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${
                        activeSection === "chatbot"
                          ? "font-semibold text-blue-700"
                          : "text-slate-700"
                      }`}
                    >
                      기준서 AI 챗봇
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <p className="text-sm font-medium text-blue-700">
              ISA 기반 · AI 감사보조 분석 도구
            </p>
            <h1 className="mt-3 max-w-3xl text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl lg:text-4xl">
              재무제표·전표 데이터에서 이상징후를{" "}
              <br className="hidden sm:block" />
              빠르게 스크리닝하는 감사보조 분석 도구
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              ISA에 기반한 분석적 절차·이상탐지 모델로 재무제표와 전표의
              위험 신호를 선별해 감사인의 검토 우선순위와 감사절차를 제시합니다.
              전표(원장)를 올리면 표본이 아닌 업로드된 전 건을 대상으로
              분석합니다.
            </p>
            <p className="mt-4 max-w-2xl rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              ※ 산출물은 감사인의 추가 검토가 필요한 <b>스크리닝 지표</b>이며,
              부정·오류를 확정하는 감사증거나 결론이 아닙니다. 상장기업(DART)·AI
              인식 경로는 요약 재무제표만 제공되어 전표 단위 부정탐지(Benford·RSF·
              라운드트립·JE 테스트)는 전표를 업로드한 경우에만 동작합니다.
            </p>
            <div className="mt-8 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => {
                  setActiveSection("demo");
                  goToSection("demo");
                }}
                className="inline-flex items-center justify-center rounded-lg bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 active:bg-blue-900"
              >
                지금 분석 체험해보기
              </button>

              {/* 기준서 AI 챗봇 바로가기 — 아이콘 + 라벨, 클릭 시 챗봇으로 이동 */}
              <div className="flex shrink-0 flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection("chatbot");
                    goToSection("chatbot");
                  }}
                  aria-label="기준서 AI 챗봇 열기"
                  title="기준서 AI 챗봇"
                  className="group relative inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-700 text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow-md"
                >
                  {/* 로봇 아이콘 */}
                  <svg
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 3v2.5" />
                    <circle cx="12" cy="2.5" r="1" fill="currentColor" stroke="none" />
                    <rect x="4.5" y="6.5" width="15" height="11" rx="3" />
                    <circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none" />
                    <circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
                    <path d="M9.5 15.2h5" />
                    <path d="M2.5 10.5v4M21.5 10.5v4" />
                  </svg>
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400 text-[9px] font-bold text-white">
                    AI
                  </span>
                </button>
                <span className="text-xs font-medium text-slate-500">
                  기준서 AI 챗봇
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        {activeSection === "features" && (
        <section id="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          {expandedFeature ? (
            <FeatureDetail
              title={expandedFeature}
              onBack={() => setExpandedFeature(null)}
            />
          ) : (
            <>
              <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">
                핵심 기능
              </h2>
              <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {FEATURES.map((f) => (
                  <button
                    type="button"
                    key={f.title}
                    onClick={() => setExpandedFeature(f.title)}
                    className="group relative cursor-pointer rounded-xl border border-slate-200 bg-[#f4f7fc] p-5 text-left shadow-sm transition-shadow hover:shadow-md hover:border-slate-300"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="absolute top-4 right-4 h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500"
                      aria-hidden="true"
                    >
                      <path d="M5 19L17 7" />
                      <path d="M7 7h10v10" />
                    </svg>
                    <h3 className="text-sm font-semibold text-slate-900 pr-6">
                      {f.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {f.desc}
                    </p>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
        )}

        {/* Demo */}
        {activeSection === "demo" && (
        <section id="demo" className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
            <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">
              분석 체험하기
            </h2>

            <div className="mt-5 inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setInputMode("dart")}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  inputMode === "dart"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                상장기업 검색
              </button>
              <button
                type="button"
                onClick={() => setInputMode("excel")}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  inputMode === "excel"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                비상장기업 엑셀 업로드
              </button>
              <button
                type="button"
                onClick={() => setInputMode("upstage")}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  inputMode === "upstage"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                재무제표 이미지/PDF 자동인식
              </button>
            </div>

            {inputMode === "dart" ? (
              <>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  기업명을 입력하면 DART에 등록된 실제 기업을 검색합니다.
                  목록에서 기업을 선택한 뒤 사업연도와 보고서 종류를 골라
                  재무제표를 불러오면, 재무비율과 이상 변동 계정을 바로 확인할
                  수 있습니다. 선택 내역은 이 브라우저(로컬스토리지)에만
                  저장됩니다.
                </p>

                <div className="mt-4">
                  <div className="relative">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="m21 21-4.35-4.35" />
                    </svg>

                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="예: 삼성전자"
                      className={`w-full rounded-lg border border-slate-300 py-3 pl-10 text-sm text-slate-900 shadow-sm transition-shadow placeholder:text-slate-400 hover:shadow-md focus:border-blue-600 focus:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-600/20 ${
                        voiceSupported ? "pr-11" : "pr-4"
                      }`}
                    />

                    {voiceSupported && (
                      <button
                        type="button"
                        onClick={handleVoiceSearch}
                        aria-label={
                          listening ? "음성 인식 중지" : "음성으로 기업명 검색"
                        }
                        title={listening ? "음성 인식 중지" : "음성으로 검색"}
                        className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 transition-colors ${
                          listening
                            ? "text-red-600"
                            : "text-slate-400 hover:text-slate-600"
                        }`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`h-4 w-4 ${listening ? "animate-pulse" : ""}`}
                          aria-hidden="true"
                        >
                          <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                          <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                          <path d="M12 18v4" />
                          <path d="M8 22h8" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {query.trim() && (
                    <div className="mt-2 rounded-lg border border-slate-200 bg-white shadow-sm">
                      {searching && (
                        <p className="px-4 py-3 text-sm text-slate-400">
                          DART에서 검색 중...
                        </p>
                      )}
                      {!searching && searchError && (
                        <p className="px-4 py-3 text-sm text-red-600">
                          {searchError}
                        </p>
                      )}
                      {!searching && !searchError && results.length === 0 && (
                        <p className="px-4 py-3 text-sm text-slate-400">
                          검색 결과가 없습니다.
                        </p>
                      )}
                      {!searching && !searchError && results.length > 0 && (
                        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                          {results.map((corp) => (
                            <li key={corp.corp_code}>
                              <button
                                type="button"
                                onClick={() => handleSelect(corp)}
                                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                              >
                                <div>
                                  <p className="text-sm font-medium text-slate-900">
                                    {corp.corp_name}
                                  </p>
                                  <p className="text-xs text-slate-400">
                                    고유번호 {corp.corp_code}
                                  </p>
                                </div>
                                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                  {corp.stock_code
                                    ? `상장 · ${corp.stock_code}`
                                    : "비상장"}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                {selectedCorp && (
                  <div className="mt-4 rounded-lg border border-slate-200 p-4">
                    <p className="text-sm font-medium text-slate-900">
                      선택한 기업: {selectedCorp.corp_name}
                      {selectedCorp.stock_code && (
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          {selectedCorp.stock_code}
                        </span>
                      )}
                    </p>

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="text-xs text-slate-500">
                          사업연도
                        </label>
                        <input
                          type="text"
                          value={bsnsYear}
                          onChange={(e) => setBsnsYear(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">
                          보고서 종류
                        </label>
                        <select
                          value={reprtCode}
                          onChange={(e) => setReprtCode(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        >
                          {Object.entries(REPRT_CODE_LABELS).map(
                            ([code, label]) => (
                              <option key={code} value={code}>
                                {label}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">
                          재무제표 종류
                        </label>
                        <select
                          value={fsDiv}
                          onChange={(e) =>
                            setFsDiv(e.target.value as "OFS" | "CFS")
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        >
                          {Object.entries(FS_DIV_LABELS).map(
                            ([code, label]) => (
                              <option key={code} value={code}>
                                {label}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleFetchDartFinancials}
                      disabled={dartFetching}
                      className="mt-3 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {dartFetching ? (
                        <LoadingDots text="불러오는 중" />
                      ) : (
                        "재무제표 불러오기"
                      )}
                    </button>

                    {dartFetchError && (
                      <p className="mt-2 text-sm text-red-600">
                        {dartFetchError}
                      </p>
                    )}

                    {dartFinancials && (
                      <div className="mt-3 space-y-3">
                        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                          인식 완료: 재무상태표 {dartFinancials.bs.length}개
                          계정 · 손익계산서 {dartFinancials.is.length}개 계정 —
                          아래 <b>최근 등록한 분석 요청</b>에 분석 결과가 자동으로
                          펼쳐집니다.
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : inputMode === "excel" ? (
              <div className="mt-4">
                <p className="text-sm leading-6 text-slate-600">
                  DART 공시자료가 없는 비상장법인은 표준 엑셀 템플릿에 재무제표를
                  입력해 업로드하면 됩니다. 업로드한 내용은 이
                  브라우저에서만 처리되고 서버에 저장되지 않습니다.
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <a
                    href="/api/template"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-800"
                  >
                    표준 템플릿 다운로드
                  </a>
                  <button
                    type="button"
                    onClick={handleLoadSampleExcel}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
                  >
                    파일 없이 샘플 데이터로 체험하기 →
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  <input
                    type="text"
                    value={excelCompanyName}
                    onChange={(e) => setExcelCompanyName(e.target.value)}
                    placeholder="회사명 (예: OO 주식회사)"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />

                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={handleExcelFileChange}
                    className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                  />

                  {excelFileName && (
                    <p className="text-xs text-slate-400">
                      선택한 파일: {excelFileName}
                    </p>
                  )}
                  {excelParsing && (
                    <p className="text-sm text-slate-400">
                      파일을 읽는 중...
                    </p>
                  )}
                  {excelError && (
                    <p className="text-sm text-red-600">{excelError}</p>
                  )}
                  {excelParsed && !excelError && (
                    <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                      인식 완료:{" "}
                      {Object.entries(excelParsed.sheets)
                        .map(([sheet, rows]) => `${sheet} ${rows.length}건`)
                        .join(" · ")}{" "}
                      · 전표데이터 {excelParsed.journalRowCount}건
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleAddExcelRequest}
                    disabled={!excelParsed || !excelCompanyName.trim()}
                    className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    분석 요청에 추가
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-sm leading-6 text-slate-600">
                  갖고 계신 재무제표 PDF나 스캔 이미지를 그대로 업로드하면
                  Upstage AI가 핵심 재무 지표를 자동으로 읽어옵니다. 인식된
                  값은 검토 후 추가해주세요.
                </p>

                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  ⚠ 업로드한 파일은 외부 AI 서비스(Upstage)로 전송됩니다. 공인회계사
                  비밀유지의무상, 별도 데이터처리계약(DPA) 없이 실제 고객의 기밀
                  재무제표를 올리지 마세요 — 테스트·공개 자료로만 사용하세요.
                </p>

                <div className="mt-4">
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleUpstageFileChange}
                    className="mt-3 block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                  />

                  {upstageFileName && (
                    <p className="mt-2 text-xs text-slate-400">
                      선택한 파일: {upstageFileName}
                    </p>
                  )}
                  {upstageLoading && (
                    <p className="mt-2 text-sm text-slate-400">
                      Upstage AI가 문서를 읽는 중...
                    </p>
                  )}
                  {upstageError && (
                    <p className="mt-2 text-sm text-red-600">
                      {upstageError}
                    </p>
                  )}

                  {upstageHighlights && !upstageError && (() => {
                    const curCheck = checkIncomeStatement(
                      upstageHighlights,
                      "당기"
                    );
                    const prevCheck = checkIncomeStatement(
                      upstageHighlights,
                      "전기"
                    );
                    return (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                        <p className="font-medium">인식된 핵심 지표</p>

                        <div className="mt-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                            재무상태표
                          </p>
                          <table className="mt-1 w-full text-xs">
                            <thead>
                              <tr className="text-blue-500">
                                <th className="py-0.5 text-left font-normal">
                                  구분
                                </th>
                                <th className="py-0.5 text-right font-normal">
                                  당기
                                </th>
                                <th className="py-0.5 text-right font-normal">
                                  전기
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {(
                                [
                                  ["자산총계", "자산총계_당기", "자산총계_전기"],
                                  ["부채총계", "부채총계_당기", "부채총계_전기"],
                                  ["자본총계", "자본총계_당기", "자본총계_전기"],
                                ] as [string, AmountKey, AmountKey][]
                              ).map(([label, curKey, prevKey]) => (
                                <tr key={label}>
                                  <td className="py-0.5">{label}</td>
                                  <td className="py-0.5 text-right">
                                    {formatAmount(upstageHighlights[curKey])}
                                  </td>
                                  <td className="py-0.5 text-right">
                                    {formatAmount(upstageHighlights[prevKey])}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="mt-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                            손익계산서
                          </p>
                          <table className="mt-1 w-full text-xs">
                            <thead>
                              <tr className="text-blue-500">
                                <th className="py-0.5 text-left font-normal">
                                  구분
                                </th>
                                <th className="py-0.5 text-right font-normal">
                                  당기
                                </th>
                                <th className="py-0.5 text-right font-normal">
                                  전기
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className="py-0.5">매출액</td>
                                <td className="py-0.5 text-right">
                                  {formatAmount(upstageHighlights.매출액_당기)}
                                </td>
                                <td className="py-0.5 text-right">
                                  {formatAmount(upstageHighlights.매출액_전기)}
                                </td>
                              </tr>
                              <tr>
                                <td className="py-0.5">
                                  영업이익
                                  {curCheck.operatingIncomeMismatch && (
                                    <span className="ml-1 text-red-600">
                                      ⚠
                                    </span>
                                  )}
                                </td>
                                <td className="py-0.5 text-right">
                                  <div>
                                    {formatAmount(
                                      upstageHighlights.영업이익_당기
                                    )}
                                  </div>
                                  {curCheck.computedOperatingIncome != null && (
                                    <div
                                      className={
                                        curCheck.operatingIncomeMismatch
                                          ? "text-red-600"
                                          : "text-blue-400"
                                      }
                                    >
                                      계산값{" "}
                                      {formatAmount(
                                        curCheck.computedOperatingIncome
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td className="py-0.5 text-right">
                                  <div>
                                    {formatAmount(
                                      upstageHighlights.영업이익_전기
                                    )}
                                  </div>
                                  {prevCheck.computedOperatingIncome != null && (
                                    <div
                                      className={
                                        prevCheck.operatingIncomeMismatch
                                          ? "text-red-600"
                                          : "text-blue-400"
                                      }
                                    >
                                      계산값{" "}
                                      {formatAmount(
                                        prevCheck.computedOperatingIncome
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                              <tr>
                                <td className="py-0.5">
                                  당기순이익
                                  {curCheck.netIncomeMismatch && (
                                    <span className="ml-1 text-red-600">
                                      ⚠
                                    </span>
                                  )}
                                </td>
                                <td className="py-0.5 text-right">
                                  <div>
                                    {formatAmount(
                                      upstageHighlights.당기순이익_당기
                                    )}
                                  </div>
                                  {curCheck.computedNetIncome != null && (
                                    <div
                                      className={
                                        curCheck.netIncomeMismatch
                                          ? "text-red-600"
                                          : "text-blue-400"
                                      }
                                    >
                                      계산값{" "}
                                      {formatAmount(curCheck.computedNetIncome)}
                                    </div>
                                  )}
                                </td>
                                <td className="py-0.5 text-right">
                                  <div>
                                    {formatAmount(
                                      upstageHighlights.당기순이익_전기
                                    )}
                                  </div>
                                  {prevCheck.computedNetIncome != null && (
                                    <div
                                      className={
                                        prevCheck.netIncomeMismatch
                                          ? "text-red-600"
                                          : "text-blue-400"
                                      }
                                    >
                                      계산값{" "}
                                      {formatAmount(prevCheck.computedNetIncome)}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          {(curCheck.operatingIncomeMismatch ||
                            curCheck.netIncomeMismatch ||
                            prevCheck.operatingIncomeMismatch ||
                            prevCheck.netIncomeMismatch) && (
                            <p className="mt-2 text-xs text-red-600">
                              ⚠ 인식된 값과 손익계산서 산식으로 계산한 값이
                              달라요. 원본 문서를 다시 확인해주세요.
                            </p>
                          )}
                        </div>
                      </div>

                      <input
                        type="text"
                        value={upstageCompanyName}
                        onChange={(e) =>
                          setUpstageCompanyName(e.target.value)
                        }
                        placeholder="회사명 확인/수정"
                        className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      />

                      <button
                        type="button"
                        onClick={handleAddUpstageRequest}
                        disabled={!upstageCompanyName.trim()}
                        className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        분석 요청에 추가
                      </button>
                    </div>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="mt-8">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    최근 등록한 분석 요청 ({requests.length})
                  </h3>
                  {/* 지금 데이터가 어디에 저장되는지 화면에서 바로 알 수 있게
                      한다. 데모 중 "DB 연동됐나요?"에 답할 근거가 된다. */}
                  {loaded && (
                    <span
                      title={
                        backendConfigured
                          ? "서버(Supabase)에 저장되며 삭제·조회 이력이 감사증적으로 남습니다."
                          : "서버 백엔드가 구성되지 않아 이 브라우저에만 저장됩니다. 거래 단위 원장 데이터는 저장하지 않고 메모리에서만 처리합니다."
                      }
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        backendConfigured
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {backendConfigured
                        ? "서버 저장 · 감사증적 기록"
                        : "이 브라우저에만 저장"}
                    </span>
                  )}
                </div>
                {requests.length > 0 && (
                  <button
                    onClick={handleClearAll}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700"
                  >
                    전체 삭제
                  </button>
                )}
              </div>

              {requests.length === 0 ? (
                <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
                  아직 등록된 분석 요청이 없습니다.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200">
                  {requests.map((r) => (
                    <li key={r.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {r.companyName}
                            {r.stockCode && (
                              <span className="ml-2 text-xs font-normal text-slate-400">
                                {r.stockCode}
                              </span>
                            )}
                            {r.source === "excel" && (
                              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
                                비상장 · 엑셀 업로드
                              </span>
                            )}
                            {r.source === "upstage" && (
                              <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-normal text-blue-600">
                                AI 자동인식(Upstage)
                              </span>
                            )}
                          </p>
                          {r.excelSummary && (
                            <p className="mt-0.5 text-xs text-slate-400">
                              {r.excelSummary}
                            </p>
                          )}
                          <p className="text-xs text-slate-500">
                            {r.createdAt}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {r.financials && (
                            <button
                              onClick={() =>
                                setExpandedRequestId((prev) =>
                                  prev === r.id ? null : r.id
                                )
                              }
                              className="text-xs font-medium text-blue-700 hover:text-blue-800"
                            >
                              {expandedRequestId === r.id
                                ? "접기"
                                : "보기"}
                            </button>
                          )}
                          {backendConfigured && (
                            <button
                              onClick={() =>
                                setTrailRequestId((prev) =>
                                  prev === r.id ? null : r.id
                                )
                              }
                              className="text-xs font-medium text-slate-500 hover:text-slate-700"
                            >
                              {trailRequestId === r.id
                                ? "증적닫기"
                                : "감사증적"}
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(r.id)}
                            className="text-xs font-medium text-slate-400 hover:text-red-600"
                          >
                            삭제
                          </button>
                        </div>
                      </div>

                      {trailRequestId === r.id && (
                        <AuditTrail
                          sessionId={sessionIdRef.current}
                          requestId={r.id}
                        />
                      )}

                      {expandedRequestId === r.id && r.financials && (
                        <AnalysisDetail
                          financials={r.financials}
                          source={r.source}
                          companyName={r.companyName}
                          corpCode={r.corpCode}
                          stockCode={r.stockCode}
                          journalRows={r.journalRows}
                          onAttachJournalRows={(rows) =>
                            handleAttachJournalRows(r.id, rows)
                          }
                          trialBalanceRows={r.trialBalanceRows}
                          onAttachTrialBalance={(rows) =>
                            handleAttachTrialBalance(r.id, rows)
                          }
                          requestId={r.id}
                          sessionId={sessionIdRef.current}
                          backendConfigured={backendConfigured}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
        )}

        {activeSection === "chatbot" && (
          <section id="chatbot" className="border-t border-slate-200 bg-white">
            <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
              <h2 className="text-xl font-semibold text-slate-900">
                기준서 AI 챗봇
              </h2>
              <p className="mt-2 text-base leading-7 text-slate-600">
                감사 중 이슈가 생겼을 때, 관련 감사기준서(ISA) 레퍼런스를 바로
                찾아줍니다. 수록된 기준 요지만 근거로 답하고 출처(기준서 번호)를
                함께 표시하며, 근거가 없으면 지어내지 않고 &quot;기권&quot;으로
                답합니다.
              </p>
              <StandardsChat />
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 text-xs text-slate-500 sm:px-6 lg:px-8">
          회계법인 실무 감사보조 도구 · 대회 출품작 · MVP 프리뷰(DART 기업검색
          연동, 그 외 데이터는 브라우저 로컬스토리지 사용) · made by 여지범
        </div>
      </footer>
    </div>
  );
}
