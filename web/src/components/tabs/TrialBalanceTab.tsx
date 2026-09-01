"use client";

import {
  downloadTrialBalanceTemplate,
  type TbCheckResult,
  type TrialBalanceRow,
} from "@/lib/trialBalance";
import SampleDataButton from "@/components/SampleDataButton";
import { SAMPLE_TRIAL_BALANCE } from "@/lib/sampleData";

/** 시산표(TB) 검증 탭. 차대변 균형·당기 발생액 일치·계정별 roll-forward를 본다.
 * 이 검증을 통과해야 이후 분석·표본추출의 기초로 신뢰할 수 있다. */
export default function TrialBalanceTab({
  tbFileName,
  tbParsing,
  tbError,
  tbCheck,
  handleTbFileChange,
  onAttachTrialBalance,
  trialBalanceRows,
}: {
  tbFileName: string | null;
  tbParsing: boolean;
  tbError: string | null;
  tbCheck: TbCheckResult | null;
  handleTbFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAttachTrialBalance: (rows: TrialBalanceRow[]) => void;
  trialBalanceRows?: TrialBalanceRow[];
}) {
  return (
      <div className="mt-3 space-y-4">
        <p className="text-xs text-slate-400">
          클라이언트 총계정원장에서 뽑은 시산표가 무결한지 먼저 검증합니다
          — 이후 모든 분석·표본추출은 이 시산표를 신뢰한다는 전제 위에서
          이뤄지기 때문입니다. 잔액은 차변 양수(+)·대변 음수(−)의
          부호형으로 입력하세요.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadTrialBalanceTemplate}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            시산표 템플릿 다운로드
          </button>
          <SampleDataButton
            label="파일 없이 샘플 시산표로 체험하기"
            onClick={() => onAttachTrialBalance(SAMPLE_TRIAL_BALANCE)}
          />
        </div>

        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3">
          {trialBalanceRows ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-600">
                시산표 {trialBalanceRows.length.toLocaleString()}개 계정이
                연결되어 있습니다.
              </p>
              <label className="cursor-pointer text-xs font-medium text-blue-700 hover:text-blue-800">
                다른 파일로 교체
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={handleTbFileChange}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            <>
              <label className="flex cursor-pointer flex-col gap-1.5 text-xs">
                <span className="font-medium text-slate-700">
                  시산표 업로드
                </span>
                <span className="text-slate-400">
                  &apos;시산표&apos; 시트 또는 첫 시트에
                  계정코드·계정과목·기초잔액·당기차변·당기대변·기말잔액
                  순서로 입력합니다.
                </span>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={handleTbFileChange}
                  className="mt-1 block text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
              </label>
              {tbFileName && tbParsing && (
                <p className="mt-1.5 text-xs text-slate-400">
                  {tbFileName} 읽는 중...
                </p>
              )}
              {tbError && (
                <p className="mt-1.5 text-xs text-red-600">{tbError}</p>
              )}
            </>
          )}
        </div>

        {!trialBalanceRows ? (
          <p className="text-xs text-slate-400">
            시산표가 없습니다. 위에서 업로드하면 검증이 실행됩니다.
          </p>
        ) : tbCheck ? (
          <>
            <p className="text-xs text-slate-500">
              시산표 {tbCheck.rowCount.toLocaleString()}개 계정 검증
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div
                className={`rounded-lg border p-3 ${
                  tbCheck.isBalanced
                    ? "border-slate-200 bg-white"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <p className="text-xs font-semibold text-slate-900">
                  {tbCheck.isBalanced ? "✅ " : "⚠ "}차대변 균형 (기말잔액
                  합계)
                </p>
                <p
                  className={`mt-1 text-lg font-bold ${
                    tbCheck.isBalanced ? "text-slate-900" : "text-red-600"
                  }`}
                >
                  {tbCheck.closingBalanceSum.toLocaleString()}원
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {tbCheck.isBalanced
                    ? "기말잔액 합계가 0 — 차변과 대변이 일치합니다."
                    : "0이 아닙니다. 이 금액만큼 차대변이 맞지 않습니다."}
                </p>
              </div>

              <div
                className={`rounded-lg border p-3 ${
                  tbCheck.periodActivityBalanced
                    ? "border-slate-200 bg-white"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <p className="text-xs font-semibold text-slate-900">
                  {tbCheck.periodActivityBalanced ? "✅ " : "⚠ "}당기 발생액
                  균형
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  차변 합계 {tbCheck.periodDebitTotal.toLocaleString()}원
                </p>
                <p className="text-xs text-slate-600">
                  대변 합계 {tbCheck.periodCreditTotal.toLocaleString()}원
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {tbCheck.periodActivityBalanced
                    ? "당기 차변·대변 발생액이 일치합니다."
                    : `차이 ${(tbCheck.periodDebitTotal - tbCheck.periodCreditTotal).toLocaleString()}원`}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-700">
                계정별 roll-forward 검증 (기초 + 당기차변 − 당기대변 = 기말)
              </p>
              {tbCheck.rollForwardMismatches.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  ✅ 모든 계정의 기초·증감·기말이 정합합니다.
                </p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-lg border border-red-200">
                  <table className="w-full text-[11px]">
                    <thead className="bg-red-50">
                      <tr className="text-slate-500">
                        <th className="px-2 py-1.5 text-left font-medium">
                          계정코드
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium">
                          계정과목
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          기대 기말
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          실제 기말
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          차이
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {tbCheck.rollForwardMismatches
                        .slice(0, 50)
                        .map((m, i) => (
                          <tr
                            key={`${m.code}-${i}`}
                            className="border-t border-red-100"
                          >
                            <td className="px-2 py-1 text-slate-600">
                              {m.code}
                            </td>
                            <td className="px-2 py-1 text-slate-600">
                              {m.account}
                            </td>
                            <td className="px-2 py-1 text-right text-slate-600">
                              {m.expected.toLocaleString()}
                            </td>
                            <td className="px-2 py-1 text-right text-slate-600">
                              {m.closing.toLocaleString()}
                            </td>
                            <td className="px-2 py-1 text-right font-medium text-red-600">
                              {m.diff.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {tbCheck.rollForwardMismatches.length > 50 && (
                    <p className="px-2 py-1.5 text-[11px] text-slate-400">
                      … 외 {(tbCheck.rollForwardMismatches.length - 50).toLocaleString()}건
                      (상위 50건만 표시)
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
  );
}
