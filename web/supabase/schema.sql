-- 회계감사 AI 분석도구 — 백엔드 스키마 (Supabase / Postgres)
-- Supabase 대시보드 → SQL Editor에 붙여넣고 실행하세요.
--
-- 설계 원칙
--  1) 로그인 없이도 쓰도록, 브라우저가 만든 session_id(uuid)로 소유를 구분한다.
--  2) 거래 단위 원장(전표)·시산표는 고객 기밀이라 서버에 저장하지 않는다.
--     (요약 재무제표 financials만 저장 — 분석 재현용)
--  3) 감사 이벤트(audit_events)는 append-only(불변). UPDATE/DELETE를 트리거로
--     원천 차단해, 서버 키로도 과거 기록을 조작·삭제할 수 없게 한다.
--  4) 분석 요청 삭제는 hard delete가 아니라 soft delete(deleted_at)로 처리해
--     감사증적을 보존한다.

-- ── 분석 요청(감사 대상 스냅샷) ─────────────────────────────
create table if not exists public.analysis_requests (
  id           uuid primary key default gen_random_uuid(),
  session_id   text not null,
  company_name text not null,
  source       text not null check (source in ('dart', 'excel', 'upstage')),
  corp_code    text,
  stock_code   text,
  excel_summary text,
  financials   jsonb,                       -- 요약 BS/IS/CF만. 전표·시산표는 저장 안 함
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz                  -- soft delete (감사증적 보존)
);

-- ── 불변 감사 이벤트 로그(append-only) ─────────────────────
create table if not exists public.audit_events (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  request_id  uuid references public.analysis_requests(id),
  event_type  text not null,                -- created | loaded | report_exported | checklist_generated | deleted ...
  detail      jsonb,
  occurred_at timestamptz not null default now()
);

-- 감사 이벤트 불변성: 어떤 역할(서버 service_role 포함)로도 수정·삭제 불가
create or replace function public.forbid_audit_mutation()
  returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only (immutable); % is not allowed', tg_op;
end;
$$;

drop trigger if exists audit_events_immutable on public.audit_events;
create trigger audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function public.forbid_audit_mutation();

-- ── 인덱스 ──────────────────────────────────────────────────
create index if not exists analysis_requests_session_idx
  on public.analysis_requests (session_id, created_at desc);
create index if not exists audit_events_session_idx
  on public.audit_events (session_id, occurred_at desc);
create index if not exists audit_events_request_idx
  on public.audit_events (request_id, occurred_at desc);

-- ── RLS ─────────────────────────────────────────────────────
-- 서버 Route Handler가 service_role 키로만 접근하므로(RLS 우회), 정책은 두지
-- 않고 RLS만 켜서 anon/public 키의 직접 접근을 차단한다.
alter table public.analysis_requests enable row level security;
alter table public.audit_events       enable row level security;
