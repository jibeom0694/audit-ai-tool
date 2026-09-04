import { describe, expect, it } from "vitest";
import {
  analyzeDisclosures,
  classifyDisclosure,
  fiscalYearEndFromYear,
  isAfterFiscalYearEnd,
} from "../disclosureRisk";
import { ISA_STANDARDS } from "../isaStandards";

// 실제 DART 공시 제목 표기를 그대로 쓴다. 표기가 바뀌면 이 테스트가 먼저 깨져야 한다.

describe("classifyDisclosure — 정정공시", () => {
  it("재무정보 정정은 high로 올린다 (평범한 정기공시로 묻히면 안 된다)", () => {
    const flag = classifyDisclosure("[기재정정]사업보고서 (2024.12)");
    expect(flag.category).toBe("정정공시");
    expect(flag.severity).toBe("high");
    expect(flag.isaRefs).toContain("240");
  });

  it("첨부파일 정정은 medium — 재무정보를 고친 것이 아니다", () => {
    const flag = classifyDisclosure("[첨부정정]투자설명서");
    expect(flag.category).toBe("정정공시");
    expect(flag.severity).toBe("medium");
  });

  it("정정이면서 다른 유형이면 정정을 택하되 원래 유형을 reason에 남긴다", () => {
    const flag = classifyDisclosure("[기재정정]주요사항보고서(소송등의제기)");
    expect(flag.category).toBe("정정공시");
    expect(flag.reason).toContain("소송·분쟁");
  });

  it("정정이 아닌 사업보고서는 정기공시(info)다", () => {
    const flag = classifyDisclosure("사업보고서 (2024.12)");
    expect(flag.category).toBe("정기공시");
    expect(flag.severity).toBe("info");
  });
});

describe("classifyDisclosure — 위험 유형", () => {
  it("횡령·배임은 부정위험(ISA 240)", () => {
    // DART는 중점(ㆍ)을 쓴다. 공백/중점 제거 없이는 매칭되지 않는다.
    const flag = classifyDisclosure("횡령ㆍ배임혐의발생");
    expect(flag.category).toBe("부정혐의");
    expect(flag.severity).toBe("high");
    expect(flag.isaRefs).toEqual(["240"]);
  });

  it("회생·자본잠식은 계속기업(ISA 570)", () => {
    for (const name of ["회생절차 개시신청", "자본잠식 사실 발생", "관리종목 지정"]) {
      const flag = classifyDisclosure(name);
      expect(flag.category).toBe("계속기업");
      expect(flag.isaRefs).toContain("570");
    }
  });

  it("의견거절·기준위반은 감사보고(ISA 705)", () => {
    const flag = classifyDisclosure("감사의견 의견거절");
    expect(flag.category).toBe("감사보고");
    expect(flag.severity).toBe("high");
  });

  it("소송은 우발부채 확인 대상(ISA 501)", () => {
    const flag = classifyDisclosure("주요사항보고서(소송등의제기)");
    expect(flag.category).toBe("소송·분쟁");
    expect(flag.isaRefs).toEqual(["501"]);
  });

  it("채무보증·자금대여는 특수관계자(ISA 550)", () => {
    const flag = classifyDisclosure("타인에대한 채무보증 결정");
    expect(flag.category).toBe("특수관계자");
    expect(flag.isaRefs).toContain("550");
  });

  it("합병·감사인 변경은 지배구조", () => {
    expect(classifyDisclosure("회사합병 결정").category).toBe("지배구조");
    expect(classifyDisclosure("감사인 지정 통지").category).toBe("지배구조");
  });

  it("유상증자·전환사채는 자본거래", () => {
    expect(classifyDisclosure("유상증자 결정").category).toBe("자본거래");
    expect(classifyDisclosure("전환사채권 발행결정").category).toBe("자본거래");
  });

  it("규칙에 없는 제목은 기타(info) — 임의로 위험하다고 하지 않는다", () => {
    const flag = classifyDisclosure("임원ㆍ주요주주특정증권등소유상황보고서");
    expect(flag.category).toBe("기타");
    expect(flag.severity).toBe("info");
  });

  it("빈 제목이어도 터지지 않는다", () => {
    expect(classifyDisclosure("").category).toBe("기타");
    // @ts-expect-error 런타임 방어 확인
    expect(classifyDisclosure(undefined).category).toBe("기타");
  });
});

describe("classifyDisclosure — 규칙 우선순위", () => {
  it("부정혐의가 소송보다 먼저다", () => {
    // "횡령ㆍ배임 혐의로 인한 소송" 같은 제목에서 소송으로 내려가면 안 된다.
    const flag = classifyDisclosure("횡령ㆍ배임 혐의 관련 소송 제기");
    expect(flag.category).toBe("부정혐의");
  });

  it("계속기업이 자본거래보다 먼저다", () => {
    // 자본잠식 해소 목적의 유상증자는 자본거래가 아니라 계속기업 신호로 본다.
    const flag = classifyDisclosure("자본잠식 해소를 위한 유상증자 결정");
    expect(flag.category).toBe("계속기업");
  });
});

describe("isAfterFiscalYearEnd", () => {
  it("결산일 다음 날부터 후속사건 후보다", () => {
    expect(isAfterFiscalYearEnd("20250101", "2024-12-31")).toBe(true);
    expect(isAfterFiscalYearEnd("20241231", "2024-12-31")).toBe(false);
    expect(isAfterFiscalYearEnd("20241230", "2024-12-31")).toBe(false);
  });

  it("형식이 어긋나면 판정하지 않는다 (틀린 구획보다 무표시가 낫다)", () => {
    expect(isAfterFiscalYearEnd("2025", "2024-12-31")).toBe(false);
    expect(isAfterFiscalYearEnd("20250101", "")).toBe(false);
    expect(isAfterFiscalYearEnd("", "")).toBe(false);
  });
});

describe("fiscalYearEndFromYear", () => {
  it("12월 결산을 가정해 결산일을 만든다", () => {
    expect(fiscalYearEndFromYear("2024")).toBe("2024-12-31");
  });

  it("연도를 알 수 없으면 null (후속사건 구획을 그리지 않는다)", () => {
    expect(fiscalYearEndFromYear(undefined)).toBeNull();
    expect(fiscalYearEndFromYear("24")).toBeNull();
    expect(fiscalYearEndFromYear("")).toBeNull();
  });
});

describe("analyzeDisclosures", () => {
  const list = [
    { reportName: "[기재정정]사업보고서 (2024.12)", receiptDate: "20250320", receiptNo: "1" },
    { reportName: "횡령ㆍ배임혐의발생", receiptDate: "20250210", receiptNo: "2" },
    { reportName: "유상증자 결정", receiptDate: "20241105", receiptNo: "3" },
    { reportName: "사업보고서 (2024.12)", receiptDate: "20241001", receiptNo: "4" },
  ];

  it("severity별로 집계하고 주의 건수를 낸다", () => {
    const result = analyzeDisclosures(list, "2024-12-31");
    expect(result.counts.high).toBe(2); // 정정(재무) + 횡령
    expect(result.counts.medium).toBe(1); // 유상증자
    expect(result.counts.info).toBe(1); // 사업보고서
    expect(result.attentionCount).toBe(3);
  });

  it("결산일 이후 접수 건을 후속사건 후보로 센다", () => {
    const result = analyzeDisclosures(list, "2024-12-31");
    expect(result.subsequentEventCount).toBe(2); // 20250320, 20250210
    expect(result.items[0].isSubsequentEvent).toBe(true);
    expect(result.items[2].isSubsequentEvent).toBe(false);
  });

  it("결산일을 모르면 후속사건 판정을 하지 않는다", () => {
    const result = analyzeDisclosures(list, null);
    expect(result.fiscalYearEnd).toBeNull();
    expect(result.subsequentEventCount).toBe(0);
    expect(result.items.every((i) => !i.isSubsequentEvent)).toBe(true);
  });

  it("DART가 준 최신순 순서를 바꾸지 않는다 (시간 흐름이 깨진다)", () => {
    const result = analyzeDisclosures(list, "2024-12-31");
    expect(result.items.map((i) => i.receiptNo)).toEqual(["1", "2", "3", "4"]);
  });

  it("빈 목록도 처리한다", () => {
    const result = analyzeDisclosures([], "2024-12-31");
    expect(result.items).toEqual([]);
    expect(result.attentionCount).toBe(0);
  });
});

describe("인용하는 ISA 번호는 전부 화이트리스트에 실재해야 한다", () => {
  it("존재하지 않는 기준서를 화면에 띄우지 않는다", () => {
    // 과거 LLM이 ISA 515·541 같은 없는 번호를 지어낸 적이 있다. 하드코딩한
    // 상수라도 같은 기준으로 막는다 — 오타 하나면 똑같은 사고가 난다.
    const names = [
      "[기재정정]사업보고서 (2024.12)",
      "[첨부정정]투자설명서",
      "횡령ㆍ배임혐의발생",
      "회생절차 개시신청",
      "감사의견 의견거절",
      "주요사항보고서(소송등의제기)",
      "타인에대한 채무보증 결정",
      "회사합병 결정",
      "유상증자 결정",
      "사업보고서 (2024.12)",
    ];
    for (const name of names) {
      for (const ref of classifyDisclosure(name).isaRefs) {
        expect(ISA_STANDARDS[ref], `ISA ${ref}가 화이트리스트에 없다`).toBeDefined();
      }
    }
  });
});
