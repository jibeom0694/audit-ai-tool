"use client";

import {
  MISSTATEMENT_TYPE_LABELS,
  type Misstatement,
  type MisstatementSummary,
  type MisstatementType,
} from "@/lib/misstatements";
import type { MaterialityResult } from "@/lib/materiality";
import type { TbCheckResult } from "@/lib/trialBalance";

/** 미수정왜곡사항 집계표(SUM) 탭 — ISA 450. 개별로는 사소해 보이는 왜곡도
 * 합치면 중요성을 넘을 수 있어 한 곳에 모아 전반중요성과 비교한다. */
export default function MisstatementSummaryTab({
  materialityResult,
  misstatements,
  misstatementSummary,
  sumDescInput,
  setSumDescInput,
  sumTypeInput,
  setSumTypeInput,
  sumAmountInput,
  handleSumAmountInputChange,
  handleAddMisstatement,
  handleToggleCorrected,
  handleRemoveMisstatement,
  handleImportTbMismatches,
  tbCheck,
}: {
  materialityResult: MaterialityResult | null;
  misstatements: Misstatement[];
  misstatementSummary: MisstatementSummary;
  sumDescInput: string;
  setSumDescInput: (value: string) => void;
  sumTypeInput: MisstatementType;
  setSumTypeInput: (value: MisstatementType) => void;
  sumAmountInput: string;
  handleSumAmountInputChange: (value: string) => void;
  handleAddMisstatement: () => void;
  handleToggleCorrected: (id: string) => void;
  handleRemoveMisstatement: (id: string) => void;
  handleImportTbMismatches: () => void;
  tbCheck: TbCheckResult | null;
}) {
  return (
      <div className="mt-3">
        <p className="text-xs text-slate-400">
          개별로는 사소해 보이는 왜곡도 합치면 중요성을 넘을 수 있습니다.
          감사 중 발견한 왜곡을 여기에 모아 미수정분 합계를 전반중요성과
          비교합니다(ISA 450). 금액은 <b>세전이익에 미치는 영향</b>으로
          적되, 이익을 과대계상한 왜곡은 양수(+), 과소계상한 왜곡은
          음수(−)로 입력하세요.
        </p>

        {!materialityResult && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            먼저 <b>중요성 산정</b> 탭에서 중요성을 산출해야 합계를 판정할
            기준이 생깁니다.
          </p>
        )}

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px_130px_auto] sm:items-end">
            <div>
              <label className="text-xs font-medium text-slate-700">
                왜곡 내용
              </label>
              <input
                type="text"
                value={sumDescInput}
                onChange={(e) => setSumDescInput(e.target.value)}
                placeholder="예: 기말 재고 과대계상 (수량 착오)"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">
                유형
              </label>
              <select
                value={sumTypeInput}
                onChange={(e) =>
                  setSumTypeInput(e.target.value as MisstatementType)
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              >
                {(
                  Object.keys(MISSTATEMENT_TYPE_LABELS) as MisstatementType[]
                ).map((k) => (
                  <option key={k} value={k}>
                    {MISSTATEMENT_TYPE_LABELS[k].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">
                세전이익 영향
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={sumAmountInput}
                onChange={(e) => handleSumAmountInputChange(e.target.value)}
                placeholder="+1,000,000"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>
            <button
              type="button"
              onClick={handleAddMisstatement}
              disabled={!sumDescInput.trim() || !sumAmountInput.trim()}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              추가
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-slate-500">
            {MISSTATEMENT_TYPE_LABELS[sumTypeInput].note}
          </p>

          {tbCheck && tbCheck.rollForwardMismatches.length > 0 && (
            <button
              type="button"
              onClick={handleImportTbMismatches}
              className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              시산표 roll-forward 불일치{" "}
              {tbCheck.rollForwardMismatches.length}건 불러오기
            </button>
          )}
        </div>

        {/* 전표 예외항목을 왜곡으로 오해하지 않도록 명시한다. */}
        <p className="mt-2 text-[11px] leading-4 text-slate-400">
          ※ 전표(JE) 테스트의 예외항목은 자동으로 들어오지 않습니다.
          &quot;주말 전기&quot; 같은 신호는 조사 대상이지 확정된 왜곡금액이
          아니므로, 실제로 조사해 왜곡으로 확정한 건만 직접 추가하세요.
        </p>

        {misstatements.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
            아직 집계된 왜곡사항이 없습니다.
          </p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">왜곡 내용</th>
                    <th className="py-2 pr-3 font-medium">유형</th>
                    <th className="py-2 pr-3 text-right font-medium">
                      세전이익 영향
                    </th>
                    <th className="py-2 pr-3 text-center font-medium">
                      수정됨
                    </th>
                    <th className="py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {misstatements.map((m) => {
                    const trivial =
                      materialityResult != null &&
                      Math.abs(m.incomeEffect) <
                        materialityResult.clearlyTrivial;
                    return (
                      <tr
                        key={m.id}
                        className={m.corrected ? "text-slate-400" : ""}
                      >
                        <td className="py-2 pr-3">
                          {m.description}
                          {trivial && !m.corrected && (
                            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                              CTT 미만
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {MISSTATEMENT_TYPE_LABELS[m.type].label}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right tabular-nums ${
                            m.corrected
                              ? ""
                              : m.incomeEffect > 0
                                ? "text-red-600"
                                : "text-blue-700"
                          }`}
                        >
                          {m.incomeEffect > 0 ? "+" : ""}
                          {Math.round(m.incomeEffect).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 text-center">
                          <input
                            type="checkbox"
                            checked={m.corrected}
                            onChange={() => handleToggleCorrected(m.id)}
                            aria-label={`${m.description} 수정 여부`}
                            className="h-3.5 w-3.5 accent-blue-700"
                          />
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveMisstatement(m.id)}
                            className="text-slate-400 hover:text-red-600"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">
                  미수정 순합계 (상계 후)
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                  {misstatementSummary.netUncorrected > 0 ? "+" : ""}
                  {Math.round(
                    misstatementSummary.netUncorrected
                  ).toLocaleString()}
                  원
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  미수정 {misstatementSummary.uncorrectedCount}건
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">
                  미수정 총규모 (절대값)
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                  {Math.round(
                    misstatementSummary.grossUncorrected
                  ).toLocaleString()}
                  원
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  상계에 기대지 않은 총합
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">비교 기준</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                  {materialityResult
                    ? `${Math.round(materialityResult.overall).toLocaleString()}원`
                    : "—"}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  전반중요성 (OM)
                </p>
              </div>
            </div>

            {materialityResult && (
              <div
                className={`mt-4 rounded-lg border px-4 py-3 ${
                  misstatementSummary.exceedsOverall ||
                  misstatementSummary.hasIndividuallyMaterial
                    ? "border-red-200 bg-red-50"
                    : "border-emerald-200 bg-emerald-50"
                }`}
              >
                <p
                  className={`text-xs font-semibold ${
                    misstatementSummary.exceedsOverall ||
                    misstatementSummary.hasIndividuallyMaterial
                      ? "text-red-800"
                      : "text-emerald-800"
                  }`}
                >
                  {misstatementSummary.exceedsOverall
                    ? "미수정 왜곡의 합계가 전반중요성을 초과합니다"
                    : misstatementSummary.hasIndividuallyMaterial
                      ? "개별적으로 전반중요성을 초과하는 왜곡이 있습니다"
                      : "미수정 왜곡의 합계가 전반중요성 이내입니다"}
                </p>
                <p
                  className={`mt-1 text-xs leading-5 ${
                    misstatementSummary.exceedsOverall ||
                    misstatementSummary.hasIndividuallyMaterial
                      ? "text-red-700"
                      : "text-emerald-700"
                  }`}
                >
                  {misstatementSummary.exceedsOverall ||
                  misstatementSummary.hasIndividuallyMaterial
                    ? "경영진에게 수정을 요구하고, 수정되지 않으면 감사의견에 미치는 영향을 검토해야 합니다."
                    : "다만 질적 요인(추세 반전, 약정 위반, 경영진 보상 관련 등)은 금액과 무관하게 중요할 수 있으므로 별도로 판단하세요."}
                  {misstatementSummary.belowThresholdCount > 0 &&
                    ` 명백히 사소한 기준(CTT) 미만 ${misstatementSummary.belowThresholdCount}건이 포함돼 있습니다 — 집계에서 제외할 수 있습니다.`}
                </p>
              </div>
            )}
          </>
        )}
      </div>
  );
}
