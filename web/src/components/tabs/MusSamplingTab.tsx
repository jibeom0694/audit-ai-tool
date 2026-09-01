"use client";

import type { MusConfidenceLevel, MusResult } from "@/lib/musSampling";
import type { StatementRow } from "@/lib/financials";

/** MUS 샘플링 탭. 모집단은 재무제표 전체가 아니라 계정 단위로 잡는다 —
 * 실무에서 표본설계는 재고자산·매출채권처럼 실사·조회 대상 계정별로 한다. */
export default function MusSamplingTab({
  musConfidenceLevel,
  setMusConfidenceLevel,
  musPopulationInput,
  setMusPopulationInput,
  musPopulationAmount,
  musTolerableInput,
  setMusTolerableInput,
  musTolerableMisstatement,
  musExpectedRateInput,
  setMusExpectedRateInput,
  musExpectedMisstatementRate,
  musResult,
  musAccountOptions,
  handleMusSelectAccount,
  handleMusAmountInputChange,
}: {
  musConfidenceLevel: MusConfidenceLevel;
  setMusConfidenceLevel: (value: MusConfidenceLevel) => void;
  musPopulationInput: string;
  setMusPopulationInput: (value: string) => void;
  musPopulationAmount: number;
  musTolerableInput: string;
  setMusTolerableInput: (value: string) => void;
  musTolerableMisstatement: number;
  musExpectedRateInput: string;
  setMusExpectedRateInput: (value: string) => void;
  musExpectedMisstatementRate: number;
  musResult: MusResult | null;
  musAccountOptions: (StatementRow & { stmt: "재무상태표" | "손익계산서" })[];
  handleMusSelectAccount: (accountKey: string) => void;
  handleMusAmountInputChange: (setter: (v: string) => void, value: string) => void;
}) {
  return (
      <div className="mt-3">
        <p className="text-xs text-slate-400">
          MUS는 재무제표 전체가 아니라 재고자산·매출채권처럼 실증절차
          대상이 되는 개별 계정 잔액 하나를 모집단으로 삼아 계산합니다.
          아래에서 계정을 선택하면 그 계정의 당기 잔액이 모집단 총액에
          자동으로 채워집니다. 자산총계·자본금·당기순이익처럼 여러 상세
          계정의 합계이거나 실물 확인 대상 거래가 없는 계정은 실사가
          불가능해 선택 목록에서 제외했습니다.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs text-slate-500">신뢰수준</label>
            <select
              value={musConfidenceLevel}
              onChange={(e) =>
                setMusConfidenceLevel(
                  Number(e.target.value) as MusConfidenceLevel
                )
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            >
              <option value={90}>90%</option>
              <option value={95}>95%</option>
              <option value={99}>99%</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-500">
              예상오류율 (%, 선택)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={musExpectedRateInput}
              onChange={(e) => setMusExpectedRateInput(e.target.value)}
              placeholder="예: 0.5"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs text-slate-500">
              계정 선택 (모집단 자동입력)
            </label>
            <select
              defaultValue=""
              onChange={(e) => handleMusSelectAccount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            >
              <option value="">직접 입력 또는 계정 선택...</option>
              {(["재무상태표", "손익계산서"] as const).map((stmt) => (
                <optgroup key={stmt} label={stmt}>
                  {musAccountOptions
                    .filter((r) => r.stmt === stmt)
                    .map((r) => (
                      <option
                        key={`${stmt}::${r.account}`}
                        value={`${stmt}::${r.account}`}
                      >
                        {r.account} ({Math.round(r.current).toLocaleString()}원)
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-500">
              모집단 총액 (원)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={musPopulationInput}
              onChange={(e) =>
                handleMusAmountInputChange(
                  setMusPopulationInput,
                  e.target.value
                )
              }
              placeholder="예: 42,081,734,000,000"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          <div>
            <label className="text-xs text-slate-500">
              허용왜곡금액 (원)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={musTolerableInput}
              onChange={(e) =>
                handleMusAmountInputChange(
                  setMusTolerableInput,
                  e.target.value
                )
              }
              placeholder="예: 1,000,000,000"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>
        </div>

        {musPopulationAmount > 0 && musTolerableMisstatement > 0 ? (
          musResult ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold text-slate-900">
                    표본크기
                  </p>
                  <p className="mt-1 text-lg font-bold text-slate-900">
                    {musResult.sampleSize.toLocaleString()}건
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    신뢰요소 {musResult.reliabilityFactor} (신뢰수준{" "}
                    {musConfidenceLevel}%)
                    {musExpectedMisstatementRate > 0 &&
                      ` · 확장계수 ${musResult.expansionFactor}`}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold text-slate-900">
                    표본추출 간격
                  </p>
                  <p className="mt-1 text-lg font-bold text-slate-900">
                    {Math.round(
                      musResult.samplingInterval
                    ).toLocaleString()}
                    원
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    모집단 총액 ÷ 표본크기
                  </p>
                </div>
              </div>

              {musExpectedMisstatementRate > 0 && (
                <p className="text-xs text-slate-500">
                  조정 허용왜곡금액 ={" "}
                  {Math.round(
                    musResult.adjustedTolerableMisstatement
                  ).toLocaleString()}
                  원 (허용왜곡금액 − 예상오류금액{" "}
                  {Math.round(
                    musResult.expectedMisstatementAmount
                  ).toLocaleString()}
                  원 × 확장계수 {musResult.expansionFactor})
                </p>
              )}

              <div>
                <p className="text-xs font-semibold text-slate-700">
                  계통추출 표본항목 (누적 금액 태그)
                  {musResult.isCappedPreview &&
                    ` — 상위 ${musResult.sampleTags.length}건만 표시`}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {musResult.sampleTags.map((tag, i) => (
                    <span
                      key={i}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                    >
                      {tag.toLocaleString()}원
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  각 태그가 속한 계정·거래(누적 금액 기준 위치)를 표본으로
                  선정합니다. 실제 모집단 항목 목록에 누적금액을
                  매핑해야 최종 표본이 확정됩니다.
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-red-600">
              허용왜곡금액이 예상오류금액(확장 반영)보다 작아 표본크기를
              산출할 수 없습니다. 허용왜곡금액을 높이거나 예상오류율을
              낮춰주세요.
            </p>
          )
        ) : (
          <p className="mt-3 text-xs text-slate-400">
            모집단 총액과 허용왜곡금액을 입력하면 표본크기가 계산됩니다.
          </p>
        )}
      </div>
  );
}
