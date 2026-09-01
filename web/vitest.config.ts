import { defineConfig } from "vitest/config";

// 도메인 로직(재무비율·이상탐지·전표/시산표 검증·표본설계·중요성)은 전부 순수
// 함수라 브라우저나 Next 런타임 없이 그대로 검증할 수 있다. UI(page.tsx)와
// 외부 연동(DART·Upstage·Supabase)은 이 스위트의 범위가 아니다 — 네트워크·키가
// 필요하고, "server-only" 잠금이 걸려 있어 노드 테스트 환경에서 로드되지 않는다.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/__tests__/**/*.test.ts"],
  },
});
