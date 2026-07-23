"use client";

import { useEffect, useState } from "react";
import {
  parseFinancialTemplate,
  type JournalRow,
  type ParsedFinancials,
} from "@/lib/excelParse";
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

type AnalysisRequest = {
  id: string;
  companyName: string;
  source: "dart" | "excel" | "upstage";
  corpCode?: string;
  stockCode?: string;
  excelSummary?: string;
  financials?: NormalizedFinancials;
  journalRows?: JournalRow[];
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
    desc: "Benford's Law, Beneish M-Score, Altman Z-Score, RSF 테스트, 순환거래 네트워크 분석으로 부정거래 가능성을 스크리닝합니다.",
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
    desc: "분석 결과를 시각화하고, 감사조서 형태의 리포트로 export할 수 있습니다.",
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
        category: "순환거래 네트워크 분석",
        description:
          "거래처(또는 계열사)를 노드로, 거래를 화살표로 그린 뒤 A→B→C→A처럼 원을 그리며 되돌아오는 거래 흐름(순환거래)이 있는지 그래프 알고리즘으로 탐지합니다. 실질적인 경제적 효과 없이 매출을 부풀리는 전형적인 분식 수법을 잡아내는 데 씁니다.",
        ratios: [
          {
            label: "사이클 탐지(Cycle Detection)",
            formula: "그래프 순회 알고리즘(예: DFS 기반 강한 연결요소 탐색)으로 거래 네트워크 내 순환 경로 탐색",
            meaning:
              "예를 들어 A사가 B사에 물건을 팔고, B사는 C사에, C사는 다시 A사에 파는 식으로 자금과 상품이 한 바퀴 돌아오면 실질 매출 없이 장부상 매출만 부풀려질 수 있습니다. 특수관계자·반복 거래처 데이터에서 이런 순환 구조를 찾아 감사 표본으로 우선 선정하는 데 씁니다.",
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
            formula: "Beneish M-Score>−1.78 · Altman Z′-Score<2.9 · Benford 카이제곱>15.51 · RSF≥3배 · 순환거래 탐지",
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
  return { assets, liabilities, equity };
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
          changes.map((c, i) => (
            <tr key={`${c.account}-${i}`} className={c.isAbnormal ? "bg-red-50" : ""}>
              <td
                className={`border-b border-slate-100 ${cellPad} text-slate-700`}
                style={{ wordBreak: "keep-all" }}
              >
                {c.account}
              </td>
              <td className={`border-b border-slate-100 ${cellPad} text-right text-slate-600`}>
                {formatAmountByUnit(c.prior, unit)}
              </td>
              <td className={`border-b border-slate-100 ${cellPad} text-right text-slate-600`}>
                {formatAmountByUnit(c.current, unit)}
              </td>
              <td
                className={`border-b border-slate-100 ${cellPad} text-right font-medium ${
                  c.isAbnormal ? "text-red-600" : "text-slate-600"
                }`}
              >
                {c.changeRate == null ? "-" : `${c.changeRate.toFixed(1)}%`}
                {c.isAbnormal && " ⚠"}
              </td>
            </tr>
          ))
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

const ISA_STANDARDS: Record<string, { title: string; summary: string }> = {
  "200": {
    title: "독립된 감사인의 전반적 목적 및 감사기준에 따른 감사의 수행",
    summary:
      "감사인이 재무제표가 중요하게 왜곡되지 않았다는 합리적 확신을 얻고, 그 결과를 보고서로 전달하는 감사 전반의 목적과 기본 원칙을 규정합니다.",
  },
  "230": {
    title: "감사문서화",
    summary:
      "수행한 감사절차, 입수한 감사증거, 감사인이 도달한 결론을 문서화하는 형식·내용·범위에 관한 요구사항입니다.",
  },
  "240": {
    title: "재무제표감사와 관련된 부정에 대한 감사인의 책임",
    summary:
      "부정으로 인한 중요왜곡표시위험을 식별·평가하고 이에 대응하는 감사인의 책임을 다룹니다. 경영진의 통제 무력화 위험 등이 핵심입니다.",
  },
  "300": {
    title: "감사업무의 계획수립",
    summary:
      "효과적인 감사를 위해 전반적인 감사전략과 세부 감사계획을 수립하는 절차를 규정합니다.",
  },
  "315": {
    title: "기업과 기업환경에 대한 이해를 통한 중요왜곡표시위험의 식별과 평가",
    summary:
      "기업과 내부통제를 이해하여 재무제표 수준 및 경영진 주장 수준에서 중요왜곡표시위험을 식별·평가하는 절차입니다.",
  },
  "320": {
    title: "감사계획수립과 감사수행에 있어서의 중요성",
    summary:
      "중요성 금액(materiality)을 설정하고 이를 감사계획·수행에 적용하는 방법을 규정합니다.",
  },
  "330": {
    title: "평가된 위험에 대한 감사인의 대응",
    summary:
      "식별된 중요왜곡표시위험 수준에 맞춰 실증절차·통제테스트 등 추가 감사절차를 설계·수행하도록 요구합니다.",
  },
  "402": {
    title: "서비스조직을 이용하는 기업에 대한 감사 고려사항",
    summary:
      "외부 서비스조직(예: 급여 대행사)을 이용하는 기업을 감사할 때 고려해야 할 사항을 다룹니다.",
  },
  "450": {
    title: "감사 중 식별된 왜곡표시의 평가",
    summary:
      "감사 중 발견한 왜곡표시가 재무제표에 미치는 영향과 중요성 여부를 평가하는 절차입니다.",
  },
  "500": {
    title: "감사증거",
    summary:
      "감사의견의 근거가 되는 충분하고 적합한 감사증거를 구성하는 요소와 이를 입수하는 절차를 규정합니다.",
  },
  "501": {
    title: "감사증거 — 특정항목에 대한 구체적 고려사항",
    summary:
      "재고자산 실사 입회, 소송·분쟁 조회, 부문정보 등 특정 계정·항목에 대해 추가로 필요한 감사증거 입수 절차를 다룹니다.",
  },
  "505": {
    title: "외부조회",
    summary:
      "채권·채무 등 계정 잔액이나 거래조건을 제3자에게 직접 확인(조회)하는 절차를 설계·수행하는 방법을 규정합니다.",
  },
  "510": {
    title: "초도감사업무 — 기초잔액",
    summary:
      "최초로 감사를 수행하는 기업의 기초잔액이 중요하게 왜곡되지 않았고 회계정책이 일관되게 적용되었는지 확인하는 절차입니다.",
  },
  "520": {
    title: "분석적절차",
    summary:
      "재무비율·추세 등 재무·비재무 데이터 간의 관계를 분석해 이상 변동이나 예상치 못한 관계를 식별하는 절차입니다.",
  },
  "530": {
    title: "감사표본",
    summary:
      "모집단 전체에 결론을 내리기 위해 표본을 설계·추출·평가하는 통계적·비통계적 표본감사 절차를 규정합니다.",
  },
  "540": {
    title: "회계추정치(공정가치 관련 추정치 포함)에 대한 감사",
    summary:
      "대손충당금, 감가상각, 공정가치 평가 등 경영진의 추정이 개입되는 계정에 대한 감사절차와 편의(bias) 평가를 다룹니다.",
  },
  "550": {
    title: "특수관계자",
    summary:
      "특수관계자 거래를 식별하고, 그 거래가 정상적인 조건으로 이루어졌는지 및 적절히 공시되었는지 확인하는 절차입니다.",
  },
  "560": {
    title: "후속사건",
    summary:
      "보고기간 후 발생한 사건이 재무제표에 미치는 영향을 식별하고 적절히 반영·공시되었는지 확인하는 절차입니다.",
  },
  "570": {
    title: "계속기업",
    summary:
      "경영진의 계속기업 가정의 적정성을 평가하고, 계속기업으로서의 존속능력에 대한 중요한 불확실성이 있는지 검토하는 절차입니다.",
  },
  "580": {
    title: "서면진술",
    summary:
      "경영진으로부터 재무제표 작성 책임 등에 대한 서면진술을 입수하여 감사증거로 활용하는 절차입니다.",
  },
  "600": {
    title: "그룹재무제표감사 — 특수 고려사항",
    summary:
      "종속회사 등 구성단위가 있는 그룹 재무제표를 감사할 때, 구성단위 감사인의 업무 활용 등 특수하게 고려할 사항을 규정합니다.",
  },
  "610": {
    title: "내부감사인의 업무 활용",
    summary:
      "내부감사기능의 업무를 외부감사인이 활용할 수 있는지, 그 범위와 평가 방법을 규정합니다.",
  },
  "620": {
    title: "감사인이 활용하는 전문가의 업무 활용",
    summary:
      "평가·법률 등 감사인의 전문지식 밖의 사항에 대해 외부 전문가의 업무를 활용할 때의 고려사항을 다룹니다.",
  },
  "700": {
    title: "재무제표에 대한 의견형성과 보고",
    summary:
      "감사증거에 기초해 재무제표 전체에 대한 의견을 형성하고 감사보고서의 형식과 내용을 규정합니다.",
  },
  "701": {
    title: "핵심감사사항의 커뮤니케이션",
    summary:
      "당기 재무제표 감사에서 가장 유의적이었던 사항(핵심감사사항)을 감사보고서에 커뮤니케이션하는 방법을 규정합니다.",
  },
  "705": {
    title: "독립된 감사인의 보고서상 의견변형",
    summary:
      "한정의견·부적정의견·의견거절 등 변형된 의견을 표명해야 하는 상황과 그 보고 방법을 규정합니다.",
  },
  "706": {
    title: "감사보고서상 강조사항 및 기타사항문단",
    summary:
      "의견에 영향을 주지는 않지만 이용자의 주의를 환기할 필요가 있는 사항을 감사보고서에 추가하는 절차입니다.",
  },
  "720": {
    title: "감사받은 재무제표가 포함된 문서 내 기타정보에 대한 책임",
    summary:
      "사업보고서 등 재무제표 이외의 기타정보를 검토하여 재무제표나 감사인의 이해와 중대하게 불일치하는지 확인하는 절차입니다.",
  },
};

function formatIsaReferenceKo(reference: string): string {
  const match = reference.match(/(\d{3})/);
  const entry = match ? ISA_STANDARDS[match[1]] : undefined;
  return entry ? `ISA ${match![1]} ${entry.title}` : reference;
}

function IsaStandardModal({
  reference,
  onClose,
}: {
  reference: string;
  onClose: () => void;
}) {
  const match = reference.match(/(\d{3})/);
  const entry = match ? ISA_STANDARDS[match[1]] : undefined;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h4 className="text-sm font-semibold text-slate-900">
            {entry ? `ISA ${match![1]}` : reference}
          </h4>
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
        <div className="px-5 py-4">
          <p className="text-xs text-slate-400">{reference}</p>
          {entry ? (
            <>
              <p className="mt-2 text-sm font-medium text-slate-900">
                {entry.title}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                {entry.summary}
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs leading-5 text-slate-500">
              이 기준서에 대한 요약 정보가 아직 준비되지 않았습니다.
            </p>
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
 * 이상탐지 모델(Beneish/Altman/Benford/RSF/순환거래) 판정 결과까지 한 줄씩
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
      const rate = c.changeRate == null ? "-" : `${c.changeRate.toFixed(1)}%`;
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
      `[Benford's Law] 표본 ${benfordResult.sampleSize}건, 카이제곱 ${benfordResult.chiSquare.toFixed(2)} (기준 15.51 초과) — 거래금액 분포가 정상 범위에서 벗어남`
    );
  }

  rsfFlags.forEach((f) => {
    lines.push(
      `[RSF 테스트] ${f.account} 계정: 최대금액이 2번째로 큰 금액의 ${f.rsf.toFixed(1)}배 — 이상치 거래 가능성`
    );
  });

  roundTripFlags.forEach((f) => {
    lines.push(
      `[순환거래 탐지] 거래처 ${f.counterparty}와 ${f.daysApart}일 간격으로 반대 방향의 유사 금액 거래(${f.amount1.toLocaleString()}원 ↔ ${f.amount2.toLocaleString()}원) — 라운드트립 의심`
    );
  });

  return lines.join("\n");
}

function AnalysisDetail({
  financials,
  source,
  companyName,
  corpCode,
  stockCode,
  journalRows,
  onAttachJournalRows,
}: {
  financials: NormalizedFinancials;
  source: AnalysisRequest["source"];
  companyName: string;
  corpCode?: string;
  stockCode?: string;
  journalRows?: JournalRow[];
  onAttachJournalRows: (rows: JournalRow[]) => void;
}) {
  const unit: AmountUnit = source === "dart" ? "million" : "thousand";

  const [materialityInput, setMaterialityInput] = useState("");
  const materialityAmount =
    Number(materialityInput.replace(/,/g, "").trim()) || 0;
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
    "ratio" | "anomaly" | "checklist" | "disclosure"
  >("ratio");

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

  const ratioGroups = calculateRatios(financials);
  const valuationRatios = calculateValuationRatios(financials, stockPrice);
  const displayGroups: { category: string; ratios: Ratio[] }[] = [
    ...ratioGroups,
    { category: "가치평가", ratios: valuationRatios },
  ];
  const crossChecks = crossCheckAccounts(financials);

  // Beneish M-Score/Altman Z-Score는 재무제표 요약만으로 계산되므로 입력
  // 경로와 무관하게 항상 시도한다. Benford's Law/RSF/순환거래 탐지는 거래
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
    setChecklistLoading(true);
    setChecklistError(null);
    try {
      const res = await fetch("/api/upstage/checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, riskSummary }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "체크리스트 생성 중 오류가 발생했습니다.");
      }
      setChecklist(data.checklist);
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
            (d: { reportName: string; receiptDate: string }) => ({
              reportName: d.reportName,
              receiptDate: d.receiptDate,
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
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "ratio", label: "재무비율분석" },
              { key: "anomaly", label: "이상탐지 모델" },
              { key: "checklist", label: "감사체크리스트 생성" },
              ...(corpCode
                ? ([{ key: "disclosure", label: "최근공시요약" }] as const)
                : []),
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                activeTab === tab.key
                  ? "bg-blue-700 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-300"
              }`}
            >
              {tab.label}
            </button>
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
                  {group.category === "가치평가" && (
                    <div className="mt-1 mb-1.5 flex flex-col gap-1">
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
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {stockPriceFetching
                            ? "실시간 조회 중..."
                            : "실시간 주가 조회"}
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
              Benford&apos;s Law·RSF 테스트·순환거래 탐지는 거래 단위 데이터(전표데이터)가
              있어야 계산되며, 엑셀 업로드가 아닌 DART·AI 인식 항목이라도 아래에서
              전표데이터를 별도로 업로드하면 함께 계산됩니다.
            </p>

            <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white p-3">
              {journalRows ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-600">
                    전표데이터 {journalRows.length}건이 연결되어 있습니다.
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
                      전표데이터 업로드 (선택) — Benford&apos;s Law·RSF·순환거래
                      탐지에 사용됩니다
                    </span>
                    <span className="text-slate-400">
                      표준 템플릿의 &apos;전표데이터&apos; 시트 형식(전표번호·전기일자·전기시각·계정과목·거래처·차변·대변·작성자·승인자·적요)이어야
                      합니다. 이 회사의 다른 재무제표 시트는 비어 있어도 됩니다.
                    </span>
                    <input
                      type="file"
                      accept=".xlsx"
                      onChange={handleJournalFileChange}
                      className="mt-1 block text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                    />
                  </label>
                  {journalFileName && journalUploadParsing && (
                    <p className="mt-1.5 text-xs text-slate-400">
                      {journalFileName} 읽는 중...
                    </p>
                  )}
                  {journalUploadError && (
                    <p className="mt-1.5 text-xs text-red-600">
                      {journalUploadError}
                    </p>
                  )}
                </>
              )}
            </div>

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
                  <p
                    className={`border-t border-slate-200 px-2 py-1.5 text-xs ${
                      benfordResult.isSuspicious ? "text-red-600" : "text-slate-500"
                    }`}
                  >
                    표본 {benfordResult.sampleSize}건 · 카이제곱{" "}
                    {benfordResult.chiSquare.toFixed(2)} (기준 15.51)
                    {benfordResult.isSuspicious
                      ? " — 벤포드 분포에서 유의미하게 벗어남 ⚠"
                      : " — 정상 범위"}
                  </p>
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
                순환거래(라운드트립) 탐지
              </p>
              {!journalRows ? (
                <p className="mt-1 text-xs text-slate-400">
                  전표데이터가 없습니다. 위에서 업로드하면 계산됩니다.
                </p>
              ) : roundTripFlags.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">
                  의심되는 라운드트립 거래가 없습니다.
                </p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {roundTripFlags.map((f, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs"
                    >
                      <p className="font-medium text-slate-700">
                        ⚠ 거래처: {f.counterparty}
                      </p>
                      <p className="mt-0.5 text-slate-600">
                        {f.date1} {f.amount1.toLocaleString()}원 ↔ {f.date2}{" "}
                        {f.amount2.toLocaleString()}원 ({f.daysApart}일 간격)
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                    <button
                      type="button"
                      onClick={() => setOpenIsaReference(item.isaReference)}
                      className="mt-1 text-xs font-medium text-blue-700 underline decoration-dotted hover:text-blue-800"
                    >
                      {formatIsaReferenceKo(item.isaReference)}
                    </button>
                  </div>
                ))}
              </div>
            )}
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
              {disclosureLoading ? "공시 조회 중..." : "최근 공시 AI 요약"}
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
                    <div
                      key={i}
                      className={`rounded-lg border p-2.5 text-xs ${
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
                      </p>
                      {item.note && (
                        <p className="mt-0.5 text-slate-600">{item.note}</p>
                      )}
                    </div>
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

export default function Home() {
  const [activeSection, setActiveSection] = useState<"features" | "demo">(
    "features"
  );
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoveredMenuItem, setHoveredMenuItem] = useState<
    "features" | "demo" | null
  >(null);

  const [inputMode, setInputMode] = useState<"dart" | "excel" | "upstage">(
    "dart"
  );

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CorpSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setRequests(JSON.parse(raw));
    } catch {
      // 로컬스토리지를 읽을 수 없는 환경이면 빈 목록으로 시작
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
  }, [requests, loaded]);

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

  function handleAddDartRequest() {
    if (!selectedCorp || !dartFinancials) return;

    const newRequest: AnalysisRequest = {
      id: crypto.randomUUID(),
      companyName: selectedCorp.corp_name,
      source: "dart",
      corpCode: selectedCorp.corp_code,
      stockCode: selectedCorp.stock_code,
      financials: dartFinancials,
      createdAt: new Date().toLocaleString("ko-KR"),
    };
    setRequests((prev) => [newRequest, ...prev]);
    setSelectedCorp(null);
    setDartFinancials(null);
    setDartFetchError(null);
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

  function handleAddExcelRequest() {
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

    const newRequest: AnalysisRequest = {
      id: crypto.randomUUID(),
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

  function handleAddUpstageRequest() {
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

    const newRequest: AnalysisRequest = {
      id: crypto.randomUUID(),
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
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  function handleAttachJournalRows(id: string, journalRows: JournalRow[]) {
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, journalRows } : r))
    );
  }

  function handleClearAll() {
    setRequests([]);
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
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
                    onMouseEnter={() => setHoveredMenuItem("features")}
                    onMouseLeave={() => setHoveredMenuItem(null)}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSection("features");
                        setExpandedFeature(null);
                        setMenuOpen(false);
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
                      className={`absolute right-full top-0 mr-2 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg transition-all duration-500 ease-out ${
                        hoveredMenuItem === "features"
                          ? "visible translate-x-0 opacity-100"
                          : "invisible translate-x-2 opacity-0"
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
                    onMouseEnter={() => setHoveredMenuItem("demo")}
                    onMouseLeave={() => setHoveredMenuItem(null)}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSection("demo");
                        setMenuOpen(false);
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
                      className={`absolute right-full top-0 mr-2 w-60 rounded-lg border border-slate-200 bg-white p-2 shadow-lg transition-all duration-500 ease-out ${
                        hoveredMenuItem === "demo"
                          ? "visible translate-x-0 opacity-100"
                          : "invisible translate-x-2 opacity-0"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveSection("demo");
                          setInputMode("dart");
                          setMenuOpen(false);
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
                        }}
                        className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
                      >
                        재무제표 이미지/PDF 자동인식
                      </button>
                    </div>
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
              AI 기반 회계감사 분석 플랫폼
            </p>
            <h1 className="mt-3 max-w-3xl text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl lg:text-4xl">
              전수 데이터 분석으로 이상징후를 조기에 탐지하고,
              <br className="hidden sm:block" />
              회계투명성 확보에 기여합니다
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              표본감사가 아닌 전수 데이터 분석으로 재무제표 이상징후와
              부정거래 가능성을 자동으로 탐지하고, 감사인의 시각에서
              위험요인을 파악하여 감사절차를 제시하는 AI 기반 감사보조 분석
              도구입니다.
            </p>
            <div className="mt-8">
              <button
                type="button"
                onClick={() => setActiveSection("demo")}
                className="inline-flex items-center justify-center rounded-lg bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800"
              >
                지금 분석 체험해보기
              </button>
            </div>
          </div>
        </section>

        {/* Features */}
        {activeSection === "features" && (
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
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
                    className="group relative cursor-pointer rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md hover:border-slate-300"
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

                <div className="relative mt-4">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="예: 삼성전자"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />

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
                      {dartFetching ? "불러오는 중..." : "재무제표 불러오기"}
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
                          계정 · 손익계산서 {dartFinancials.is.length}개 계정
                        </div>
                        <button
                          type="button"
                          onClick={handleAddDartRequest}
                          className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800"
                        >
                          분석 요청에 추가
                        </button>
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

                <a
                  href="/api/template"
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-800"
                >
                  표준 템플릿 다운로드
                </a>

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
                <h3 className="text-sm font-semibold text-slate-900">
                  최근 등록한 분석 요청 ({requests.length})
                </h3>
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
                          <button
                            onClick={() => handleDelete(r.id)}
                            className="text-xs font-medium text-slate-400 hover:text-red-600"
                          >
                            삭제
                          </button>
                        </div>
                      </div>

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
