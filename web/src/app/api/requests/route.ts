import { isBackendConfigured } from "@/lib/supabaseServer";
import {
  listRequests,
  createRequest,
  softDeleteRequest,
} from "@/lib/auditStore";

// 분석 요청 서버 저장 엔드포인트. 백엔드(Supabase)가 구성돼 있지 않으면
// { configured: false }를 돌려주고, 클라이언트는 localStorage 폴백으로 동작한다.

export async function GET(request: Request) {
  if (!isBackendConfigured()) {
    return Response.json({ configured: false, requests: [] });
  }
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id") ?? "";
  if (!sessionId) {
    return Response.json({ error: "session_id가 필요합니다." }, { status: 400 });
  }
  try {
    const requests = await listRequests(sessionId);
    return Response.json({ configured: true, requests });
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
    const {
      session_id,
      company_name,
      source,
      corp_code = null,
      stock_code = null,
      excel_summary = null,
      financials = null,
    } = body;
    if (!session_id || !company_name || !source) {
      return Response.json(
        { error: "session_id·company_name·source는 필수입니다." },
        { status: 400 }
      );
    }
    const created = await createRequest({
      session_id,
      company_name,
      source,
      corp_code,
      stock_code,
      excel_summary,
      financials,
    });
    return Response.json({ configured: true, request: created });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isBackendConfigured()) {
    return Response.json({ configured: false }, { status: 200 });
  }
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id") ?? "";
  const id = searchParams.get("id") ?? "";
  if (!sessionId || !id) {
    return Response.json(
      { error: "session_id·id가 필요합니다." },
      { status: 400 }
    );
  }
  try {
    await softDeleteRequest(sessionId, id);
    return Response.json({ configured: true, ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
