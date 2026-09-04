"use client";

import LoadingDots from "@/components/LoadingDots";
import type { DisclosureReviewItem } from "./types";
import {
  SUBSEQUENT_EVENT_WINDOW_DAYS,
  type ClassifiedDisclosure,
  type DisclosureAnalysis,
  type DisclosureSeverity,
} from "@/lib/disclosureRisk";

/**
 * 공시 검토 탭. 두 단계로 나뉜다.
 *
 * ① 규칙 분류 — DART 공시 제목을 감사 관점 범주로 갈라 보여준다. LLM을 거치지
 *    않으므로 결과가 항상 같고, 제3자 AI 동의 없이도 볼 수 있다. 공시 목록은
 *    공개된 사실이라 이걸 AI 뒤에 숨겨둘 이유가 없다.
 * ② AI 보충 의견 — 위 목록을 LLM에 넘겨 코멘트를 받는다. 선택 사항이며,
 *    규칙 분류를 덮어쓰지 않고 각 건 아래에 덧붙는다.
 */

const SEVERITY_STYLE: Record<
  DisclosureSeverity,
  { row: string; badge: string; label: string }
> = {
  high: {
    row: "border-red-200 bg-red-50",
    badge: "bg-red-100 text-red-700",
    label: "주의",
  },
  medium: {
    row: "border-amber-200 bg-amber-50",
    badge: "bg-amber-100 text-amber-800",
    label: "확인",
  },
  info: {
    row: "border-slate-200 bg-white",
    badge: "bg-slate-100 text-slate-600",
    label: "참고",
  },
};

function SummaryBar({
  analysis,
  truncated,
}: {
  analysis: DisclosureAnalysis;
  truncated: boolean;
}) {
  const { counts, subsequentEventCount, fiscalYearEnd } = analysis;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
        <span>
          전체 <strong>{analysis.items.length}</strong>건
        </span>
        <span className="text-red-700">
          주의 <strong>{counts.high}</strong>건
        </span>
        <span className="text-amber-800">
          확인 <strong>{counts.medium}</strong>건
        </span>
        <span className="text-slate-500">참고 {counts.info}건</span>
      </div>
      {fiscalYearEnd && (
        <p className="mt-1.5 text-xs text-slate-500">
          결산일({fiscalYearEnd}) 이후 {SUBSEQUENT_EVENT_WINDOW_DAYS}일 이내 접수{" "}
          <strong>{subsequentEventCount}</strong>건 — ISA 560 후속사건 검토
          후보입니다. 감사보고서일을 알 수 없어 사업보고서 제출기한(결산 후{" "}
          {SUBSEQUENT_EVENT_WINDOW_DAYS}일)을 상한으로 삼았고, 결산월 정보가 없어
          12월 결산으로 가정했습니다.
        </p>
      )}
      {truncated && (
        <p className="mt-1.5 text-xs text-amber-800">
          ⚠ 공시 건수가 조회 한도를 넘어 일부만 표시했습니다. 이 목록은 전수가
          아니므로, 특정 사건을 확인하려면 DART에서 직접 검색하세요.
        </p>
      )}
    </div>
  );
}

function DisclosureRow({
  item,
  aiNote,
}: {
  item: ClassifiedDisclosure;
  aiNote?: string;
}) {
  const style = SEVERITY_STYLE[item.flag.severity];
  return (
    <div className={`rounded-lg border p-2.5 text-xs ${style.row}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${style.badge}`}
        >
          {style.label}
        </span>
        <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[11px] text-slate-700">
          {item.flag.category}
        </span>
        {item.isSubsequentEvent && (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] text-blue-700">
            결산일 이후
          </span>
        )}
        {item.flag.isaRefs.map((ref) => (
          <span
            key={ref}
            className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[11px] text-slate-700"
          >
            ISA {ref}
          </span>
        ))}
      </div>

      <p className="mt-1.5 font-medium text-slate-800">
        {item.reportName}
        <span className="ml-2 font-normal text-slate-400">
          {item.receiptDate}
        </span>
      </p>

      <p className="mt-0.5 text-slate-600">{item.flag.reason}</p>

      {aiNote && (
        <p className="mt-1.5 border-l-2 border-slate-300 pl-2 text-slate-600">
          <span className="font-medium text-slate-500">AI 의견 </span>
          {aiNote}
        </p>
      )}

      <a
        href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.receiptNo}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block text-blue-700 hover:underline"
      >
        DART 원문 보기 ↗
      </a>
    </div>
  );
}

export default function DisclosureTab({
  analysis,
  truncated,
  loading,
  error,
  onLoad,
  aiItems,
  aiLoading,
  aiError,
  onSummarize,
}: {
  analysis: DisclosureAnalysis | null;
  truncated: boolean;
  loading: boolean;
  error: string | null;
  onLoad: () => void;
  aiItems: DisclosureReviewItem[] | null;
  aiLoading: boolean;
  aiError: string | null;
  onSummarize: () => void;
}) {
  // AI 의견은 접수번호로 붙인다. 순서가 아니라 키로 맞춰야 LLM이 건수를
  // 빠뜨리거나 순서를 바꿔 돌려줘도 엉뚱한 공시에 달리지 않는다.
  const aiNotes = new Map(
    (aiItems ?? [])
      .filter((i) => i.note)
      .map((i) => [i.receiptNo, i.note] as const)
  );

  return (
    <div className="mt-3">
      <p className="text-xs text-slate-400">
        감사 대상 사업연도와 그 직후(제출기한까지)의 DART 공시를 감사 관점
        범주로 분류합니다. 분류는 공시 제목에 대한 규칙 판정이며, 각 건의 실제
        내용은 DART 원문으로 확인해야 합니다.
      </p>

      <button
        type="button"
        onClick={onLoad}
        disabled={loading}
        className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <LoadingDots text="공시 조회 중" /> : "최근 공시 불러오기"}
      </button>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {analysis &&
        (analysis.items.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">
            최근 1년간 공시 내역이 없습니다.
          </p>
        ) : (
          <>
            <SummaryBar analysis={analysis} truncated={truncated} />

            <div className="mt-3 space-y-1.5">
              {analysis.items.map((item) => (
                <DisclosureRow
                  key={item.receiptNo}
                  item={item}
                  aiNote={aiNotes.get(item.receiptNo)}
                />
              ))}
            </div>

            <div className="mt-3 border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={onSummarize}
                disabled={aiLoading}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiLoading ? (
                  <LoadingDots text="AI 검토 중" />
                ) : (
                  "AI 보충 의견 받기 (선택)"
                )}
              </button>
              <p className="mt-1.5 text-xs text-slate-400">
                공시 제목이 외부 AI로 전송됩니다. 회사명은 보내지 않습니다. AI
                의견은 위 분류를 대체하지 않는 초안이며, 최종 판단은 감사인이
                직접 내려야 합니다.
              </p>
              {aiError && <p className="mt-2 text-xs text-red-600">{aiError}</p>}
            </div>
          </>
        ))}
    </div>
  );
}
