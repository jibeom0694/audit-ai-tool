"use client";

import type { NormalizedFinancials } from "./financials";

// 클라이언트에서 서버 저장/감사증적 API를 부르는 얇은 래퍼. 백엔드(Supabase)가
// 구성돼 있지 않으면 각 함수는 조용히 실패(null/무시)하고, 호출부는 기존
// localStorage 경로로 폴백한다.

const SESSION_KEY = "audit-ai-session-id";

/** 로그인 없이 소유를 구분하기 위한 브라우저 세션 id(uuid). 최초 1회 생성·보관. */
export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export type ServerRequest = {
  id: string;
  company_name: string;
  source: "dart" | "excel" | "upstage";
  corp_code: string | null;
  stock_code: string | null;
  excel_summary: string | null;
  financials: NormalizedFinancials | null;
  created_at: string;
};

export type ServerAuditEvent = {
  id: string;
  request_id: string | null;
  event_type: string;
  detail: Record<string, unknown> | null;
  occurred_at: string;
};

/** 서버 저장 목록을 가져온다. { configured } 로 백엔드 활성 여부를 함께 알려준다. */
export async function fetchServerRequests(
  sessionId: string
): Promise<{ configured: boolean; requests: ServerRequest[] }> {
  try {
    const res = await fetch(
      `/api/requests?session_id=${encodeURIComponent(sessionId)}`
    );
    const data = await res.json();
    return {
      configured: !!data.configured,
      requests: data.requests ?? [],
    };
  } catch {
    return { configured: false, requests: [] };
  }
}

export type NewServerRequest = {
  session_id: string;
  company_name: string;
  source: "dart" | "excel" | "upstage";
  corp_code?: string | null;
  stock_code?: string | null;
  excel_summary?: string | null;
  financials?: NormalizedFinancials | null;
};

/** 서버에 요청을 저장하고 저장된 레코드(서버 id 포함)를 돌려준다. 백엔드
 * 미구성이거나 실패 시 null. */
export async function createServerRequest(
  input: NewServerRequest
): Promise<ServerRequest | null> {
  try {
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok || !data.configured || !data.request) return null;
    return data.request as ServerRequest;
  } catch {
    return null;
  }
}

export async function deleteServerRequest(
  sessionId: string,
  id: string
): Promise<void> {
  try {
    await fetch(
      `/api/requests?session_id=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
  } catch {
    // 폴백 모드거나 실패 — 무시
  }
}

export async function appendServerEvent(
  sessionId: string,
  requestId: string | null,
  eventType: string,
  detail?: Record<string, unknown>
): Promise<void> {
  if (!sessionId) return;
  try {
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        request_id: requestId,
        event_type: eventType,
        detail: detail ?? null,
      }),
    });
  } catch {
    // 감사 이벤트 기록 실패가 주기능을 막지 않도록 무시
  }
}

export async function fetchServerEvents(
  sessionId: string,
  requestId: string
): Promise<ServerAuditEvent[]> {
  try {
    const res = await fetch(
      `/api/events?session_id=${encodeURIComponent(sessionId)}&request_id=${encodeURIComponent(requestId)}`
    );
    const data = await res.json();
    return data.events ?? [];
  } catch {
    return [];
  }
}
