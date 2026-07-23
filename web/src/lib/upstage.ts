import "server-only";

const ENDPOINT = "https://api.upstage.ai/v1/information-extraction";

export type FinancialHighlights = {
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

// Upstage Information Extraction: 첫 단계 속성은 string/number/array만 허용되고
// 중첩 객체는 불가하므로, 계정과목별로 당기/전기를 별도 필드로 나눠 정의한다.
// 매출원가/판관비/영업외수익/영업외비용/법인세비용까지 함께 추출해서, 영업이익과
// 당기순이익을 손익계산서 산식으로 재계산해 인식값과 교차검증할 수 있게 한다.
const HIGHLIGHTS_SCHEMA = {
  name: "financial_highlights",
  schema: {
    type: "object",
    properties: {
      company_name: { type: "string" },
      자산총계_당기: { type: "number" },
      자산총계_전기: { type: "number" },
      부채총계_당기: { type: "number" },
      부채총계_전기: { type: "number" },
      자본총계_당기: { type: "number" },
      자본총계_전기: { type: "number" },
      매출액_당기: { type: "number" },
      매출액_전기: { type: "number" },
      매출원가_당기: { type: "number" },
      매출원가_전기: { type: "number" },
      판매비와관리비_당기: { type: "number" },
      판매비와관리비_전기: { type: "number" },
      영업이익_당기: { type: "number" },
      영업이익_전기: { type: "number" },
      영업외수익_당기: { type: "number" },
      영업외수익_전기: { type: "number" },
      영업외비용_당기: { type: "number" },
      영업외비용_전기: { type: "number" },
      법인세비용_당기: { type: "number" },
      법인세비용_전기: { type: "number" },
      당기순이익_당기: { type: "number" },
      당기순이익_전기: { type: "number" },
    },
  },
};

export async function extractFinancialHighlights(
  buffer: Buffer,
  mimeType: string
): Promise<FinancialHighlights> {
  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "UPSTAGE_API_KEY가 설정되어 있지 않습니다 (.env.local 확인)."
    );
  }

  const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "information-extract",
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: dataUri } }],
        },
      ],
      response_format: { type: "json_schema", json_schema: HIGHLIGHTS_SCHEMA },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstage 요청 실패 (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Upstage 응답에서 추출 결과를 찾을 수 없습니다.");
  }

  return JSON.parse(content) as FinancialHighlights;
}
