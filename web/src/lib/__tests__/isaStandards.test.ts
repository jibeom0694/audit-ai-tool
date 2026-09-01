import { describe, expect, it } from "vitest";
import {
  ISA_ALLOWED_LIST,
  ISA_STANDARDS,
  formatIsaReferenceKo,
  resolveIsaReference,
} from "../isaStandards";

// FR-4.4 — LLM이 지어낸 가짜 기준서를 화면에 내보내지 않는 것이 이 모듈의 유일한
// 목적이다. 프롬프트 제한은 보장이 되지 않으므로 여기가 실제 방어선이다.

describe("resolveIsaReference — 화이트리스트 통과", () => {
  it("실재하는 기준서는 번호와 한글 제목을 돌려준다", () => {
    const entry = resolveIsaReference("ISA 520 분석적 절차");
    expect(entry?.code).toBe("520");
    expect(entry?.title).toBe("분석적절차");
  });

  it("번호만 있어도 해석한다", () => {
    expect(resolveIsaReference("240")?.code).toBe("240");
  });
});

describe("resolveIsaReference — 차단", () => {
  // 아래 두 건은 실제로 LLM이 인용해 온 것이 관측된 가짜 기준서다.
  it.each([
    ["ISA 515 확정급여제도", "실재하지 않는 번호"],
    ["ISA 541 금융상품: 공시", "실재하지 않는 번호"],
    ["ISA 999", "목록 밖 번호"],
    ["", "빈 문자열"],
    ["관련 기준서 없음", "번호 없는 문자열"],
  ])("%s 는 차단된다 (%s)", (reference) => {
    expect(resolveIsaReference(reference)).toBeNull();
  });

  it("ISA 2400(검토업무 기준서)이 240으로 잘려 통과하지 않는다", () => {
    // 앞뒤 숫자 경계를 보지 않으면 "2400"에서 "240"만 잘려 감사기준서로
    // 둔갑한다. 감사(240)와 검토(2400)는 전혀 다른 업무다.
    expect(resolveIsaReference("ISA 2400")).toBeNull();
    expect(resolveIsaReference("ISA 4400 협의된절차")).toBeNull();
  });
});

describe("formatIsaReferenceKo", () => {
  it("통과한 인용만 한글 표기로 바꾼다", () => {
    expect(formatIsaReferenceKo("ISA 240")).toBe(
      "ISA 240 재무제표감사와 관련된 부정에 대한 감사인의 책임"
    );
  });

  it("차단된 인용은 null — 호출부가 원문을 그대로 노출하면 안 된다", () => {
    expect(formatIsaReferenceKo("ISA 515")).toBeNull();
  });
});

describe("ISA_ALLOWED_LIST", () => {
  it("화이트리스트 전체가 프롬프트 목록에 들어간다", () => {
    const codes = Object.keys(ISA_STANDARDS);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(ISA_ALLOWED_LIST).toContain(`ISA ${code}`);
    }
  });

  it("프롬프트 목록과 렌더링이 같은 소스를 쓴다", () => {
    // 목록이 갈라지면 프롬프트는 허용했는데 렌더링이 막는(또는 그 반대) 구멍이 생긴다.
    for (const code of Object.keys(ISA_STANDARDS)) {
      expect(resolveIsaReference(`ISA ${code}`)).not.toBeNull();
    }
  });
});
