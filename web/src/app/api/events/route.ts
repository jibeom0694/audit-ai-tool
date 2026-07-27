import { isBackendConfigured } from "@/lib/supabaseServer";
import { appendEvent, listEvents } from "@/lib/auditStore";

// 감사 이벤트(append-only) 엔드포인트. 백엔드 미구성 시 조용히 no-op.

const ALLOWED_EVENTS = new Set([
  "created",
  "loaded",
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
