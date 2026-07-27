import "server-only";
import { getSupabase } from "./supabaseServer";
import type { NormalizedFinancials } from "./financials";

// 서버 저장(Supabase) 계층. 모든 함수는 백엔드가 구성돼 있지 않으면 호출되지
// 않는다(라우트에서 isBackendConfigured로 먼저 분기). 거래 단위 원장(전표)·
// 시산표는 기밀이라 여기서 다루지 않는다 — 요약 재무제표만 저장한다.

export type StoredRequest = {
  id: string;
  session_id: string;
  company_name: string;
  source: "dart" | "excel" | "upstage";
  corp_code: string | null;
  stock_code: string | null;
  excel_summary: string | null;
  financials: NormalizedFinancials | null;
  created_at: string;
};

export type AuditEvent = {
  id: string;
  session_id: string;
  request_id: string | null;
  event_type: string;
  detail: Record<string, unknown> | null;
  occurred_at: string;
};

const REQUEST_COLUMNS =
  "id, session_id, company_name, source, corp_code, stock_code, excel_summary, financials, created_at";

export async function listRequests(sessionId: string): Promise<StoredRequest[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data, error } = await db
    .from("analysis_requests")
    .select(REQUEST_COLUMNS)
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as StoredRequest[];
}

export async function createRequest(
  input: Omit<StoredRequest, "id" | "created_at">
): Promise<StoredRequest> {
  const db = getSupabase();
  if (!db) throw new Error("backend not configured");
  const { data, error } = await db
    .from("analysis_requests")
    .insert(input)
    .select(REQUEST_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  // 감사증적: 생성 이벤트를 append (실패해도 요청 생성 자체는 유효)
  await appendEvent({
    session_id: input.session_id,
    request_id: (data as StoredRequest).id,
    event_type: "created",
    detail: { company_name: input.company_name, source: input.source },
  }).catch(() => {});
  return data as StoredRequest;
}

/** hard delete가 아니라 soft delete + 감사 이벤트 기록으로 증적을 남긴다. */
export async function softDeleteRequest(
  sessionId: string,
  id: string
): Promise<void> {
  const db = getSupabase();
  if (!db) throw new Error("backend not configured");
  const { error } = await db
    .from("analysis_requests")
    .update({ deleted_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("id", id);
  if (error) throw new Error(error.message);
  await appendEvent({
    session_id: sessionId,
    request_id: id,
    event_type: "deleted",
    detail: null,
  }).catch(() => {});
}

export async function appendEvent(
  input: Omit<AuditEvent, "id" | "occurred_at">
): Promise<void> {
  const db = getSupabase();
  if (!db) throw new Error("backend not configured");
  const { error } = await db.from("audit_events").insert(input);
  if (error) throw new Error(error.message);
}

export async function listEvents(
  sessionId: string,
  requestId: string
): Promise<AuditEvent[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data, error } = await db
    .from("audit_events")
    .select("id, session_id, request_id, event_type, detail, occurred_at")
    .eq("session_id", sessionId)
    .eq("request_id", requestId)
    .order("occurred_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditEvent[];
}
