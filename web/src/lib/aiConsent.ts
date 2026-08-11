"use client";

// ── 기밀성(제3자 AI 전송) 동의 게이트 ──
// 재무제표 이미지/PDF 자동인식(Upstage)·AI 체크리스트·공시요약·기준서 챗봇은
// 입력/파생 데이터를 외부 AI 서비스(Upstage)로 전송한다. 공인회계사의 비밀유지의무상,
// 실제 고객의 기밀 데이터가 계약(DPA) 없이 외부로 나가면 안 되므로, 이 기능들을
// 처음 쓸 때 한 번 명시적으로 동의를 받고 그 사실을 기록한다.
//
// 이 모듈로 분리해 둔 이유: 동의 게이트는 "외부로 나가는 모든 경로"에 빠짐없이
// 걸려 있어야 의미가 있다. page.tsx 안에만 두면 다른 컴포넌트(기준서 챗봇 등)가
// 게이트를 건너뛰는 구멍이 생긴다.

const AI_CONSENT_KEY = "audit-ai-thirdparty-consent";

export const AI_CONSENT_MESSAGE =
  "이 기능은 입력·파생 데이터를 외부 AI 서비스(Upstage)로 전송합니다.\n\n" +
  "· 재무제표 이미지/PDF 자동인식: 업로드한 파일이 Upstage로 전송됩니다.\n" +
  "· AI 체크리스트: 감지된 위험 신호(계정·거래처 등 포함)가 Upstage Solar로 전송됩니다.\n" +
  "· AI 공시요약: DART 공개 공시 제목이 Upstage Solar로 전송됩니다.\n" +
  "· 기준서 AI 챗봇: 입력한 질문 문장이 Upstage 임베딩·Solar로 전송됩니다.\n\n" +
  "공인회계사의 비밀유지의무상, 별도의 데이터처리계약(DPA) 없이 실제 고객의 기밀 정보를 전송하지 마세요. " +
  "테스트용·공개(상장) 데이터로만 사용하는 것을 권장합니다.\n\n" +
  "위 내용에 동의하고 계속하시겠습니까? (이 선택은 이 브라우저에 한 번만 저장됩니다)";

/** 동의를 거절했을 때 화면에 띄우는 안내. 거절 시 아무 표시 없이 멈추면
 * 기능이 고장난 것처럼 보여서, 왜 실행되지 않았는지 반드시 알려준다. */
export const AI_CONSENT_DECLINED_MESSAGE =
  "외부 AI 전송에 동의하지 않아 실행하지 않았습니다. 이 기능은 Upstage AI로 데이터를 보내야 동작하므로, 다시 실행하면 동의 창이 한 번 더 표시됩니다.";

/** 제3자 AI 전송 기능 실행 전에 1회 동의를 확인한다. 미동의 시 false를 반환하고
 * 호출부는 전송을 중단해야 한다. */
export function ensureThirdPartyAiConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(AI_CONSENT_KEY) === "granted") return true;
  } catch {
    // 로컬스토리지 접근 불가 환경 — 매번 확인
  }
  const ok = window.confirm(AI_CONSENT_MESSAGE);
  if (ok) {
    try {
      window.localStorage.setItem(AI_CONSENT_KEY, "granted");
    } catch {
      // 저장 실패해도 이번 동의는 유효
    }
  }
  return ok;
}
