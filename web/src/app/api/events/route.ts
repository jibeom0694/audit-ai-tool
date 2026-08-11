import { isBackendConfigured } from "@/lib/supabaseServer";
import { appendEvent, listEvents } from "@/lib/auditStore";

// 감사 이벤트(append-only) 엔드포인트. 백엔드 미구성 시 조용히 no-op.

// 클라이언트(page.tsx의 logEvent)가 실제로 보내는 event_type과 반드시 일치해야
// 한다. 여기 없는 값은 400으로 거부되는데 클라이언트는 실패를 무시하므로,
// 누락되면 그 절차가 감사증적에서 조용히 빠진다(실제로 materiality_applied가
// 그렇게 누락돼 있었다).
const ALLOWED_EVENTS = new Set([
  "created",
  "loaded",
  "materiality_applied",
  "report_exported",
  "checklist_generated",
  "disclosure_summarized",
  "deleted",
]);

export async function GET(request: Request) {
  if (!isBackendConfigured()) {
    return Response.json({ configured: false, events: [] });
  }
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id") ?? "";
  const requestId = searchParams.get("request_id") ?? "";
  if (!sessionId || !requestId) {
    return Response.json(
      { error: "session_id·request_id가 필요합니다." },
      { status: 400 }
    );
  }
  try {
    const events = await listEvents(sessionId, requestId);
    return Response.json({ configured: true, events });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isBackendConfigured()) {
    return Response.json({ configured: false }, { status: 200 });
  }
  try {
    const body = await request.json();
    const { session_id, request_id = null, event_type, detail = null } = body;
    if (!session_id || !event_type) {
      return Response.json(
        { error: "session_id·event_type는 필수입니다." },
        { status: 400 }
      );
    }
    if (!ALLOWED_EVENTS.has(event_type)) {
      return Response.json(
        { error: `허용되지 않은 event_type: ${event_type}` },
        { status: 400 }
      );
    }
    await appendEvent({ session_id, request_id, event_type, detail });
    return Response.json({ configured: true, ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
