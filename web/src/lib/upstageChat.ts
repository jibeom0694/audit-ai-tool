import "server-only";

const ENDPOINT = "https://api.upstage.ai/v1/chat/completions";
const MODEL = "solar-pro2";

/**
 * Upstage Solar LLM(채팅 완성 API) 호출 헬퍼. Information Extraction API와
 * 같은 UPSTAGE_API_KEY를 재사용하며, OpenAI Chat Completions와 동일한
 * 요청/응답 형태를 쓴다. 감사 체크리스트 생성·공시 요약처럼 자유형 텍스트
 * 추론이 필요한 기능에서 쓴다 (구조화 추출 전용인 IE API로는 불가능).
 */
export async function callSolarChat(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey) {
    throw new Error("UPSTAGE_API_KEY가 설정되어 있지 않습니다 (.env.local 확인).");
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstage Solar 요청 실패 (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Upstage Solar 응답에서 결과를 찾을 수 없습니다.");
  }
  return content as string;
}

/** callSolarChat과 동일하지만, JSON 스키마를 강제해 구조화된 응답을 받는다. */
export async function callSolarChatJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: { name: string; schema: Record<string, unknown> }
): Promise<T> {
  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey) {
    throw new Error("UPSTAGE_API_KEY가 설정되어 있지 않습니다 (.env.local 확인).");
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_schema", json_schema: schema },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstage Solar 요청 실패 (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Upstage Solar 응답에서 결과를 찾을 수 없습니다.");
  }
  return JSON.parse(content) as T;
}
