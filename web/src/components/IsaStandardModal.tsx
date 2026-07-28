"use client";

import { resolveIsaReference } from "@/lib/isaStandards";

// 감사기준서 상세 모달. 두 곳에서 함께 쓴다:
//   1) 감사 체크리스트의 ISA 인용 클릭
//   2) 기준서 챗봇 답변의 근거 출처 클릭
// 화이트리스트(isaStandards.ts)에 없는 인용은 애초에 클릭할 수 없게 막지만,
// 만약을 대비해 여기서도 원문을 그대로 노출하지 않는다.
export default function IsaStandardModal({
  reference,
  groundedContent,
  onClose,
}: {
  reference: string;
  /** 챗봇에서 실제로 근거로 사용된 요지 본문. 있으면 "이 답변의 근거"로
   * 별도 표시해, 무엇을 보고 답했는지 사용자가 직접 확인할 수 있게 한다. */
  groundedContent?: string;
  onClose: () => void;
}) {
  const entry = resolveIsaReference(reference);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h4 className="text-sm font-semibold text-slate-900">
            {entry ? `ISA ${entry.code}` : "기준서 확인 필요"}
          </h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M18 6 6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">
          {entry ? (
            <>
              <p className="text-sm font-medium text-slate-900">
                {entry.title}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                {entry.summary}
              </p>
              {groundedContent && (
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <p className="text-[11px] font-semibold text-slate-700">
                    이 답변의 근거로 사용된 요지
                  </p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-600">
                    {groundedContent}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs leading-5 text-slate-500">
              AI가 제시한 기준서 번호를 확인하지 못했습니다. 감사인이 직접
              해당 절차의 근거 기준서를 확인해 주세요.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
