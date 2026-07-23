export type MusConfidenceLevel = 90 | 95 | 99;

/**
 * MUS는 다수의 개별 거래로 구성된 '실사 가능한' 잔액(재고자산·매출채권 등)에만
 * 의미가 있다. 아래 계정들은 다른 상세계정의 합계(소계·총계)이거나, 자본거래·
 * 손익 소계처럼 실물 확인·조회 대상 거래가 여러 건 존재하지 않는 계정이라
 * 표본추출 모집단으로 부적합해 계정 선택 목록에서 제외한다.
 */
const MUS_INELIGIBLE_ACCOUNTS = new Set([
  // 재무상태표 소계·총계
  "자산총계",
  "유동자산",
  "비유동자산",
  "부채총계",
  "유동부채",
  "비유동부채",
  "부채와자본총계",
  // 자본 항목 — 거래 건수가 적고 실사가 아닌 계약서·등기 확인 대상
  "자본총계",
  "자본금",
  "보통주자본금",
  "우선주자본금",
  "이익잉여금",
  "주식발행초과금",
  "기타자본항목",
  // 손익 소계·1주당 지표 — 다른 계정의 계산 결과이지 그 자체가 거래 모집단이 아님
  "매출총이익",
  "영업이익",
  "법인세비용차감전순이익",
  "당기순이익",
  "법인세비용(수익)",
  "법인세비용",
  "기본주당이익",
  "희석주당이익",
]);

export function isMusEligibleAccount(accountName: string): boolean {
  return !MUS_INELIGIBLE_ACCOUNTS.has(accountName.trim());
}

export type MusInput = {
  confidenceLevel: MusConfidenceLevel;
  populationAmount: number;
  tolerableMisstatement: number;
  expectedMisstatementRate: number;
};

export type MusResult = {
  reliabilityFactor: number;
  expansionFactor: number;
  expectedMisstatementAmount: number;
  adjustedTolerableMisstatement: number;
  sampleSize: number;
  samplingInterval: number;
  sampleTags: number[];
  isCappedPreview: boolean;
};

// AICPA 감사표본 가이드에서 널리 쓰이는 포아송 신뢰요소(예상오류=0 기준)와,
// 예상오류가 있을 때 이를 반영하기 위한 확장계수.
const RELIABILITY_FACTORS: Record<MusConfidenceLevel, number> = {
  90: 2.31,
  95: 3.0,
  99: 4.61,
};

const EXPANSION_FACTORS: Record<MusConfidenceLevel, number> = {
  90: 1.5,
  95: 1.6,
  99: 2.0,
};

const SAMPLE_TAG_PREVIEW_LIMIT = 20;

export function calculateMusSampleSize(input: MusInput): MusResult | null {
  const {
    confidenceLevel,
    populationAmount,
    tolerableMisstatement,
    expectedMisstatementRate,
  } = input;

  if (populationAmount <= 0 || tolerableMisstatement <= 0) return null;

  const reliabilityFactor = RELIABILITY_FACTORS[confidenceLevel];
  const expansionFactor = EXPANSION_FACTORS[confidenceLevel];
  const expectedMisstatementAmount =
    populationAmount * (expectedMisstatementRate / 100);
  const adjustedTolerableMisstatement =
    tolerableMisstatement - expectedMisstatementAmount * expansionFactor;

  if (adjustedTolerableMisstatement <= 0) return null;

  const sampleSize = Math.ceil(
    (reliabilityFactor * populationAmount) / adjustedTolerableMisstatement
  );
  const samplingInterval = populationAmount / sampleSize;

  const previewCount = Math.min(sampleSize, SAMPLE_TAG_PREVIEW_LIMIT);
  const sampleTags = Array.from({ length: previewCount }, (_, i) =>
    Math.round(samplingInterval / 2 + i * samplingInterval)
  );

  return {
    reliabilityFactor,
    expansionFactor,
    expectedMisstatementAmount,
    adjustedTolerableMisstatement,
    sampleSize,
    samplingInterval,
    sampleTags,
    isCappedPreview: sampleSize > SAMPLE_TAG_PREVIEW_LIMIT,
  };
}
