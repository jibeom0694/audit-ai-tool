import { callSolarChatJSON } from "@/lib/upstageChat";

const SYSTEM_PROMPT =
  "당신은 한국 회계법인의 감사인입니다. 사용자가 번호를 매겨 제공하는 공시 제목 목록을 검토하세요.\n" +
  "결과 배열의 항목 수는 반드시 입력된 공시 개수와 정확히 같아야 하며, 순서도 입력 순서와 같아야 합니다. 제목 텍스트 자체는 절대 출력하지 마세요(번호로만 대응).\n" +
  "isIssue는 유상증자·소송·임원변경·특수관계자거래·자기주식·담보제공·영업정지·감사인 지정처럼 감사상 쟁점이 될 만한 유형이면 true, 단순 지분보고 등 정기 공시면 false입니다.\n" +
  "note에는 제목만으로 알 수 있는 범위 내에서 왜 쟁점인지 한 문장으로 적고, 세부 사유·금액은 모르므로 '본문 확인 필요'를 포함하세요. 쟁점이 아니면 note는 빈 문자열로 두세요.";

const DISCLOSURE_SCHEMA = {
  name: "disclosure_review",
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number" },
            isIssue: { type: "boolean" },
            note: { type: "string" },
          },
        },
      },
    },
  },
};

type DisclosureReview = {
  items: { index: number; isIssue: boolean; note: string }[];
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyName, disclosures } = body;
    if (!Array.isArray(disclosures) || disclosures.length === 0) {
      return Response.json(
        { error: "disclosures가 필요합니다." },
        { status: 400 }
      );
    }

    const list = disclosures
      .map(
        (d: { reportName: string; receiptDate: string }, i: number) =>
          `${i + 1}. [${d.receiptDate}] ${d.reportName}`
      )
      .join("\n");
    const userPrompt = `회사명: ${companyName ?? "알 수 없음"}\n\n공시 목록 (${disclosures.length}건, 번호 1~${disclosures.length}):\n${list}`;

    const result = await callSolarChatJSON<DisclosureReview>(
      SYSTEM_PROMPT,
      userPrompt,
      DISCLOSURE_SCHEMA
    );

    // LLM은 제목 텍스트를 다시 만들지 않고 번호로만 응답하므로, 우리가 이미
    // 갖고 있는 정확한 제목·날짜를 번호 기준으로 붙여서 돌려준다. 이렇게 하면
    // 한글 특수문자(ㆍ 등)를 모델이 다시 생성하면서 깨지는 문제를 피할 수 있다.
    const byIndex = new Map(result.items?.map((it) => [it.index, it]) ?? []);
    const items = disclosures.map(
      (d: { reportName: string; receiptDate: string }, i: number) => {
        const review = byIndex.get(i + 1);
        return {
          reportName: d.reportName,
          receiptDate: d.receiptDate,
          isIssue: review?.isIssue ?? false,
          note: review?.note ?? "",
        };
      }
    );

    return Response.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
