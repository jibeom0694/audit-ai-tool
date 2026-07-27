import { callSolarChatJSON } from "@/lib/upstageChat";
import { ISA_ALLOWED_LIST, resolveIsaReference } from "@/lib/isaStandards";

const CHECKLIST_SCHEMA = {
  name: "audit_checklist",
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            risk: { type: "string" },
            procedure: { type: "string" },
            isaReference: { type: "string" },
          },
        },
      },
    },
  },
};

type ChecklistResult = {
  items: { risk: string; procedure: string; isaReference: string }[];
};

const SYSTEM_PROMPT =
  "당신은 한국 회계법인의 시니어 감사인입니다. 사용자가 제공하는 '감지된 위험 신호' 목록을 한 줄씩 그대로 근거로 삼아, 각 신호마다 국제감사기준(ISA)에 근거한 구체적인 감사절차를 하나씩 제안하세요. " +
  "제공되지 않은 계정이나 위험(예: 목록에 없는 매출채권, 재고자산 등)을 임의로 추가하지 마세요 — 반드시 입력된 신호 각각에 대응하는 항목만 만드세요. " +
  "각 항목은 risk(입력된 위험 신호를 요약한 한 문장, 어떤 계정·비율인지 명시), procedure(실제로 수행할 수 있는 구체적인 감사절차), isaReference(관련 ISA 기준 번호와 명칭, 예: \"ISA 520 분석적 절차\")로 구성합니다. " +
  "입력된 신호 개수만큼만 항목을 만들고(최대 8개), 신호가 1개면 항목도 1개만 만드세요.\n\n" +
  // LLM이 실재하지 않는 기준서(예: "ISA 515", "ISA 541")를 지어내는 사례가
  // 관측돼, 인용 가능한 기준서를 아래 목록으로 못박는다. 프롬프트만으로는
  // 보장이 되지 않으므로 응답을 받은 뒤 화이트리스트로 한 번 더 거른다.
  "isaReference는 반드시 다음 목록에 있는 것 중에서만 고르세요. 목록에 없는 기준서 번호를 지어내지 마세요. " +
  "적절한 기준서가 목록에 없으면 isaReference를 빈 문자열로 두세요.\n" +
  ISA_ALLOWED_LIST;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { riskSummary } = body;
    if (!riskSummary || typeof riskSummary !== "string") {
      return Response.json(
        { error: "riskSummary가 필요합니다." },
        { status: 400 }
      );
    }

    // 데이터 최소화: 감사 대상 회사명 등 식별정보는 받지 않고, 위험 신호 텍스트만
    // 외부 AI로 보낸다.
    const userPrompt = `감지된 위험 신호:\n${riskSummary}`;
    const result = await callSolarChatJSON<ChecklistResult>(
      SYSTEM_PROMPT,
      userPrompt,
      CHECKLIST_SCHEMA
    );
    // 프롬프트로 제한해도 목록 밖 기준서를 인용해 오는 경우가 있으므로,
    // 화이트리스트에 없는 인용은 여기서 비워 클라이언트로 내보내지 않는다.
    const checklist = (result.items ?? []).map((item) => ({
      ...item,
      isaReference: resolveIsaReference(item.isaReference)
        ? item.isaReference
        : "",
    }));
    return Response.json({ checklist });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
