import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 서버 전용 Supabase 클라이언트. SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가
// 설정돼 있을 때만 생성되고, 없으면 null을 돌려준다(백엔드 미구성 = localStorage
// 폴백 모드). service_role 키는 절대 클라이언트로 노출되면 안 되므로 이 파일은
// "server-only"로 잠근다.
let cached: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached =
    url && key
      ? createClient(url, key, { auth: { persistSession: false } })
      : null;
  return cached;
}

export function isBackendConfigured(): boolean {
  return getSupabase() !== null;
}
