"use client";

import LoadingDots from "@/components/LoadingDots";
import type { DisclosureReviewItem } from "./types";

/** AI 공시요약 탭. DART 공시 목록을 LLM이 검토해 감사 관점에서 주의가 필요한
 * 건만 추려준다. 원문을 항상 확인할 수 있도록 접수번호로 DART 링크를 건다. */
export default function DisclosureTab({
  disclosureItems,
  disclosureLoading,
  disclosureError,
  onSummarize,
}: {
  disclosureItems: DisclosureReviewItem[] | null;
  disclosureLoading: boolean;
  disclosureError: string | null;
  onSummarize: () => void;
}) {
  return (
      <div className="mt-3">
        <p className="text-xs text-slate-400">
          최근 1년간 DART 공시 목록을 AI로 검토해 주의가 필요한 공시를
          표시합니다. 아래 결과는 AI가 생성한 초안이며, 최종 판단은
          감사인이 직접 내려야 합니다.
        </p>

        <button
          type="button"
          onClick={onSummarize}
          disabled={disclosureLoading}
          className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {disclosureLoading ? (
            <LoadingDots text="공시 조회 중" />
          ) : (
            "최근 공시 AI 요약"
          )}
        </button>

        {disclosureError && (
          <p className="mt-2 text-xs text-red-600">{disclosureError}</p>
        )}
        {disclosureItems &&
          (disclosureItems.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">
              최근 1년간 공시 내역이 없습니다.
            </p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {disclosureItems.map((item, i) => (
                <a
                  key={i}
                  href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.receiptNo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`block rounded-lg border p-2.5 text-xs hover:brightness-95 ${
                    item.isIssue
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <p className="font-medium text-slate-700">
                    {item.isIssue && "⚠ "}
                    {item.reportName}
                    <span className="ml-2 font-normal text-slate-400">
                      {item.receiptDate}
                    </span>
                    <span className="ml-2 text-blue-700">
                      DART 원문 보기 ↗
                    </span>
                  </p>
                  {item.note && (
                    <p className="mt-0.5 text-slate-600">{item.note}</p>
                  )}
                </a>
              ))}
            </div>
          ))}
      </div>
  );
}
