// 분석 패널 탭들이 공유하는 표시용 타입. 서버 응답(LLM 생성 결과)을 화면에
// 그리는 모양이라 도메인 로직(src/lib)이 아니라 여기에 둔다.

export type ChecklistItem = {
  risk: string;
  procedure: string;
  isaReference: string;
};

export type DisclosureReviewItem = {
  reportName: string;
  receiptDate: string;
  receiptNo: string;
  isIssue: boolean;
  note: string;
};
