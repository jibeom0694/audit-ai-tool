"use client";

import {
  BENCHMARKS,
  CTT_RATE,
  PM_RATES,
  type BenchmarkKey,
  type BenchmarkOption,
  type MaterialityResult,
  type RiskLevel,
} from "@/lib/materiality";

/** 중요성 산정 탭 — ISA 320. 여기서 나온 수행중요성이 이상 변동 필터·MUS
 * 허용왜곡금액·미수정왜곡 집계표의 판단 기준으로 함께 흘러간다. */
export default function MaterialityTab({
  matBenchmark,
  matBenchmarkOption,
  matBenchmarkIsLoss,
  matReadAmount,
  matAmount,
  matAmountInput,
  setMatAmountInput,
  matRate,
  matRateInput,
  setMatRateInput,
  matRateOutOfRange,
  matRisk,
  setMatRisk,
  materialityResult,
  materialityAmount,
  handleSelectBenchmark,
  handleApplyMateriality,
  handleMusAmountInputChange,
}: {
  matBenchmark: BenchmarkKey;
  matBenchmarkOption: BenchmarkOption;
  matBenchmarkIsLoss: boolean;
  matReadAmount: number | null;
  matAmount: number;
  matAmountInput: string;
  setMatAmountInput: (value: string) => void;
  matRate: number;
  matRateInput: string;
  setMatRateInput: (value: string) => void;
  matRateOutOfRange: boolean;
  matRisk: RiskLevel;
  setMatRisk: (value: RiskLevel) => void;
  materialityResult: MaterialityResult | null;
  materialityAmount: number;
  handleSelectBenchmark: (key: BenchmarkKey) => void;
  handleApplyMateriality: () => void;
  handleMusAmountInputChange: (setter: (v: string) => void, value: string) => void;
}) {
  return (
      <div className="mt-3">
        <p className="text-xs text-slate-400">
          중요성은 감사의 출발점입니다. 어느 계정을 얼마나 파고들지,
          표본을 몇 개 뽑을지, 발견한 왜곡을 넘길지 말지가 모두 이
          금액에서 나옵니다. ISA 320에 따라 벤치마크와 적용률을 고르면
          전반중요성·수행중요성·명백히 사소한 기준을 산출합니다.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-slate-700">
              벤치마크
            </label>
            <select
              value={matBenchmark}
              onChange={(e) =>
                handleSelectBenchmark(e.target.value as BenchmarkKey)
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            >
              {BENCHMARKS.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label} ({b.minRate}~{b.maxRate}%)
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">
              {matBenchmarkOption.guidance}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">
              벤치마크 금액 (원)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={
                matAmountInput.trim() !== ""
                  ? matAmountInput
                  : matReadAmount != null
                    ? Math.round(matReadAmount).toLocaleString()
                    : ""
              }
              onChange={(e) =>
                handleMusAmountInputChange(setMatAmountInput, e.target.value)
              }
              placeholder="재무제표에서 자동으로 읽습니다"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
            <p className="mt-1 text-[11px] leading-4 text-slate-500">
              {matReadAmount == null
                ? "재무제표에서 이 계정을 찾지 못했습니다. 금액을 직접 입력하세요."
                : "재무제표에서 읽은 값입니다. 필요하면 직접 수정할 수 있습니다."}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">
              적용률 (%)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={matRateInput}
              onChange={(e) => setMatRateInput(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
            <p className="mt-1 text-[11px] leading-4 text-slate-500">
              실무 통용범위 {matBenchmarkOption.minRate}~
              {matBenchmarkOption.maxRate}%
              {matRateOutOfRange && (
                <span className="text-amber-700">
                  {" "}
                  · 범위를 벗어났습니다. 조서에 근거를 남기세요.
                </span>
              )}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">
              평가된 위험 (수행중요성률)
            </label>
            <select
              value={matRisk}
              onChange={(e) => setMatRisk(e.target.value as RiskLevel)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            >
              {(["normal", "high"] as const).map((k) => (
                <option key={k} value={k}>
                  {PM_RATES[k].label} — 전반중요성의 {PM_RATES[k].rate}%
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">
              {PM_RATES[matRisk].note}
            </p>
          </div>
        </div>

        {matBenchmarkIsLoss && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            선택한 벤치마크가 0 이하입니다(적자 또는 매출 없음). 이익·매출
            기준은 이 경우 중요성을 왜곡하므로, 자산총계나 자본총계 기준으로
            바꾸는 것을 검토하세요.
          </p>
        )}

        {materialityResult ? (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">전반중요성 (OM)</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                  {Math.round(materialityResult.overall).toLocaleString()}원
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  벤치마크 × {matRate}%
                </p>
              </div>
              <div className="rounded-xl border-2 border-blue-600 bg-blue-50 p-4">
                <p className="text-xs font-medium text-blue-800">
                  수행중요성 (PM)
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-blue-900">
                  {Math.round(
                    materialityResult.performance
                  ).toLocaleString()}
                  원
                </p>
                <p className="mt-1 text-[11px] text-blue-700">
                  전반중요성 × {materialityResult.pmRate}% · 실제 절차에
                  쓰는 값
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">
                  명백히 사소한 기준 (CTT)
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                  {Math.round(
                    materialityResult.clearlyTrivial
                  ).toLocaleString()}
                  원
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  전반중요성 × {CTT_RATE}% · 이하는 집계 제외
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleApplyMateriality}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 active:bg-blue-900"
              >
                수행중요성을 이상변동 필터·MUS에 적용
              </button>
              {materialityAmount > 0 && (
                <span className="text-xs text-slate-500">
                  현재 적용값: {materialityAmount.toLocaleString()}원
                </span>
              )}
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold text-slate-700">
                산출 근거 (조서 첨부용)
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                벤치마크: {matBenchmarkOption.label}{" "}
                {Math.round(matAmount).toLocaleString()}원 · 적용률{" "}
                {matRate}% → 전반중요성{" "}
                {Math.round(materialityResult.overall).toLocaleString()}원.
                평가된 위험 {PM_RATES[matRisk].label}에 따라 수행중요성은
                전반중요성의 {materialityResult.pmRate}%인{" "}
                {Math.round(
                  materialityResult.performance
                ).toLocaleString()}
                원으로 설정. 명백히 사소한 기준은{" "}
                {Math.round(
                  materialityResult.clearlyTrivial
                ).toLocaleString()}
                원.
              </p>
            </div>
          </>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
            벤치마크 금액과 적용률을 입력하면 중요성이 산출됩니다.
          </p>
        )}
      </div>
  );
}
