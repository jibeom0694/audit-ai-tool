import { answerStandardsQuestion, isCorpusAvailable } from "@/lib/standardsRag";

// 기준서 AI 챗봇 — 질문을 받아 코퍼스에서 근거를 검색하고 근거기반 답변 + 인용을
// 돌려준다. 근거가 약하면 grounded:false로 기권한다(환각 차단).
export async function POST(request: Request) {
  if (!isCorpusAvailable()) {
    return Response.json(
      { error: "기준 코퍼스가 배포에 포함되지 않았습니다." },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return Response.json({ error: "query가 필요합니다." }, { status: 400 });
    }
    if (query.length > 500) {
      return Response.json(
        { error: "질문이 너무 깁니다(500자 이내)." },
        { status: 400 }
      );
    }
    const result = await answerStandardsQuestion(query);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
