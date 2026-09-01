"use client";

import LoadingDots from "@/components/LoadingDots";
import { formatIsaReferenceKo } from "@/lib/isaStandards";
import type { ChecklistItem } from "./types";

/** 감사 체크리스트 생성 탭. 위험 신호를 근거로 LLM이 감사절차 초안을 만들고,
 * ISA 인용은 화이트리스트를 통과한 것만 클릭 가능한 링크로 보여준다. */
export default function ChecklistTab({
  checklist,
  checklistLoading,
  checklistError,
  onGenerate,
  onOpenIsaReference,
}: {
  checklist: ChecklistItem[] | null;
  checklistLoading: boolean;
  checklistError: string | null;
  onGenerate: () => void;
  onOpenIsaReference: (reference: string) => void;
}) {
  return (
      <div className="mt-3">
        <p className="text-xs text-slate-400">
          재무비율·이상탐지 모델·교차검증 결과를 근거로 감사 체크리스트
          초안을 생성합니다. 아래 결과는 AI가 생성한 초안이며, 최종 판단은
          감사인이 직접 내려야 합니다.
        </p>

        {/* 이 탭의 주된 동작이라 채움형 버튼으로 강조한다. */}
        <button
          type="button"
          onClick={onGenerate}
          disabled={checklistLoading}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow disabled:cursor-not-allowed disabled:translate-y-0 disabled:bg-slate-300 disabled:shadow-none"
        >
          {checklistLoading ? (
            <LoadingDots text="체크리스트 생성 중" />
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9z" />
                <path d="M18 14l.95 2.55L21.5 17.5l-2.55.95L18 21l-.95-2.55L14.5 17.5l2.55-.95z" />
              </svg>
              감사 체크리스트 생성
            </>
          )}
        </button>

        {checklistError && (
          <p className="mt-2 text-xs text-red-600">{checklistError}</p>
        )}
        {checklist && checklist.length > 0 && (
          <div className="mt-3 space-y-2">
            {checklist.map((item, i) => (
              <div
                key={i}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <p className="text-xs font-semibold text-slate-900">
                  ⚠ {item.risk}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {item.procedure}
                </p>
                {/* AI가 실재하지 않는 기준서를 인용하는 경우가 있어,
                    화이트리스트에 있는 인용만 기준서로 표시한다. */}
                {formatIsaReferenceKo(item.isaReference) ? (
                  <button
                    type="button"
                    onClick={() => onOpenIsaReference(item.isaReference)}
                    className="mt-1 text-xs font-medium text-blue-700 underline decoration-dotted hover:text-blue-800"
                  >
                    {formatIsaReferenceKo(item.isaReference)}
                  </button>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">
                    근거 기준서 미확인 — 감사인이 직접 확인 필요
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
  );
}
