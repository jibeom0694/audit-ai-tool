"use client";

import type { ReactNode } from "react";
import type { JeTestSummary } from "@/lib/journalTests";
import type { JournalRow } from "@/lib/excelParse";

/** 전표(JE) 부정위험 테스트 탭 — ISA 240. 각 테스트는 감사인이 더 볼 예외항목을
 * 뽑아줄 뿐 부정을 확정하지 않는다. */
export default function JournalEntryTab({
  journalUploadBox,
  journalRows,
  jeTestSummary,
  jeApprovalLimitInput,
  setJeApprovalLimitInput,
  jePeriodEndInput,
  setJePeriodEndInput,
}: {
  journalUploadBox: ReactNode;
  journalRows?: JournalRow[];
  jeTestSummary: JeTestSummary | null;
  jeApprovalLimitInput: string;
  setJeApprovalLimitInput: (value: string) => void;
  jePeriodEndInput: string;
  setJePeriodEndInput: (value: string) => void;
}) {
  return (
      <div className="mt-3 space-y-4">
        <p className="text-xs text-slate-400">
          ISA 240(부정)에 따른 전표(JE) 부정위험 테스트입니다. 전표데이터를
          올리면 주말·심야 전기, 라운드넘버, 적요 공란, 작성자=승인자,
          결산일 임박 전기 등 표준 위험 기준으로 예외항목을 뽑아줍니다.
          여기서 표시되는 건 감사인이 추가로 확인할 대상이지, 부정 확정이
          아닙니다.
        </p>

        {journalUploadBox}

        {!journalRows ? (
          <p className="text-xs text-slate-400">
            전표데이터가 없습니다. 위에서 업로드하면 테스트가 실행됩니다.
          </p>
        ) : jeTestSummary ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-slate-500">
                  결산일 (선택)
                </label>
                <input
                  type="date"
                  value={jePeriodEndInput}
                  onChange={(e) => setJePeriodEndInput(e.target.value)}
                  className="mt-1 w-44 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">
                  승인한도 (원, 선택)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={jeApprovalLimitInput}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^0-9]/g, "");
                    setJeApprovalLimitInput(
                      digits ? Number(digits).toLocaleString() : ""
                    );
                  }}
                  placeholder="예: 10,000,000"
                  className="mt-1 w-44 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
              <p className="max-w-xs text-[11px] leading-tight text-slate-400">
                결산일을 비우면 데이터상 최종 전기일자로 추정합니다 — 기중
                데이터만 올렸다면 정상 전표가 예외로 잡히니 실제 결산일을
                입력하세요. 승인한도를 입력하면 한도 바로 아래 금액(분할
                전기) 테스트가 추가됩니다.
              </p>
            </div>

            <p className="text-xs text-slate-500">
              전표 {jeTestSummary.totalRows.toLocaleString()}건 분석
              {jeTestSummary.parsedDateCount < jeTestSummary.totalRows &&
                ` · 날짜 인식 ${jeTestSummary.parsedDateCount.toLocaleString()}건(형식 오류分 제외)`}
            </p>

            <div className="space-y-2">
              {jeTestSummary.results.map((test) => (
                <div
                  key={test.key}
                  className={`rounded-lg border p-3 ${
                    test.flagCount > 0
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-900">
                      {test.flagCount > 0 && "⚠ "}
                      {test.label}
                    </p>
                    <span
                      className={`shrink-0 text-xs font-semibold ${
                        test.flagCount > 0
                          ? "text-amber-700"
                          : "text-slate-400"
                      }`}
                    >
                      {test.flagCount.toLocaleString()}건
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-tight text-slate-500">
                    {test.description}
                  </p>
                  {test.flags.length > 0 && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-slate-400">
                            <th className="px-1.5 py-1 text-left font-medium">
                              전표번호
                            </th>
                            <th className="px-1.5 py-1 text-left font-medium">
                              전기일자
                            </th>
                            <th className="px-1.5 py-1 text-left font-medium">
                              계정
                            </th>
                            <th className="px-1.5 py-1 text-right font-medium">
                              금액
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {test.flags.map((f, i) => (
                            <tr
                              key={`${f.entryNo}-${i}`}
                              className="border-t border-amber-100"
                            >
                              <td className="px-1.5 py-1 text-slate-600">
                                {f.entryNo}
                              </td>
                              <td className="px-1.5 py-1 text-slate-600">
                                {f.date}
                              </td>
                              <td className="px-1.5 py-1 text-slate-600">
                                {f.account}
                              </td>
                              <td className="px-1.5 py-1 text-right text-slate-700">
                                {f.amount.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {test.flagCount > test.flags.length && (
                        <p className="mt-1 text-[11px] text-slate-400">
                          … 외 {(test.flagCount - test.flags.length).toLocaleString()}건
                          (상위 {test.flags.length}건만 표시)
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold text-slate-900">
                작성자별 전표 집중도 (상위 5명)
              </p>
              <div className="mt-2 space-y-1.5">
                {jeTestSummary.preparerConcentration.map((p) => (
                  <div key={p.name} className="text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>{p.name}</span>
                      <span>
                        {p.count.toLocaleString()}건 ({p.percent.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                      <div
                        className="h-1.5 rounded-full bg-blue-600"
                        style={{ width: `${Math.min(100, p.percent)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                특정 작성자에게 전표가 과도하게 집중되면 통제·직무분리
                측면을 검토합니다.
              </p>
            </div>
          </>
        ) : null}
      </div>
  );
}
