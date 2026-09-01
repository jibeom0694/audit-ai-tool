"use client";

import type { Ratio, CrossCheckFlag } from "@/lib/ratios";
import { formatRatioValue } from "@/lib/format";
import LoadingDots from "@/components/LoadingDots";

/** 재무비율 탭. 유동성·수익성·성장성·안정성 4개 그룹과, 성격이 다른
 * 시장지표(주가 입력 필요)를 분리해 보여준다. */
export default function RatioTab({
  ratioGroups,
  valuationRatios,
  crossChecks,
  stockPriceInput,
  stockPriceFetching,
  stockPriceMeta,
  handleStockPriceInputChange,
  handleFetchStockPrice,
  stockCode,
}: {
  ratioGroups: { category: string; ratios: Ratio[] }[];
  valuationRatios: Ratio[];
  crossChecks: CrossCheckFlag[];
  stockPriceInput: string;
  stockPriceFetching: boolean;
  stockPriceMeta: { isMarketOpen: boolean; tradedAt: string | null } | null;
  handleStockPriceInputChange: (value: string) => void;
  handleFetchStockPrice: () => void;
  stockCode?: string;
}) {
  return (
      <div className="mt-4 space-y-3">
        {/* 감사 지표 4개 그룹만 그리드에 둔다. 주가 입력이 필요한
            시장지표는 성격이 달라 아래 별도 패널로 분리했다.
            2열까지만 — 이 카드는 max-w-3xl 안에 있어서 4열로 쪼개면
            "총자산순이익률(ROA)" 같은 계정명이 값과 겹쳐 깨진다. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ratioGroups.map((group) => (
            <div
              key={group.category}
              className="rounded-lg border border-slate-200 bg-white p-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {group.category}
              </p>
              <ul className="mt-2 space-y-1.5">
                {group.ratios.map((ratio) => (
                  <li
                    key={ratio.label}
                    className="flex items-baseline justify-between gap-2 text-xs"
                  >
                    <span className="text-slate-600">{ratio.label}</span>
                    <span
                      className={`shrink-0 font-semibold tabular-nums ${
                        ratio.value == null
                          ? "text-slate-400"
                          : "text-slate-900"
                      }`}
                    >
                      {formatRatioValue(ratio.value, ratio.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              참고용 시장지표
            </p>
            <p className="text-[11px] text-slate-400">
              투자자용 주가지표 — 감사증거·분석적 절차 대상이 아닙니다
            </p>
          </div>

          <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,15rem)_1fr]">
            <div className="space-y-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={stockPriceInput}
                onChange={(e) =>
                  handleStockPriceInputChange(e.target.value)
                }
                placeholder="주가 입력(원, PER·PBR용)"
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-900 placeholder:text-xs placeholder:font-normal placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              {stockCode && (
                <button
                  type="button"
                  onClick={handleFetchStockPrice}
                  disabled={stockPriceFetching}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-700 px-2 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow disabled:cursor-not-allowed disabled:translate-y-0 disabled:bg-slate-300 disabled:shadow-none"
                >
                  {stockPriceFetching ? (
                    <LoadingDots text="실시간 조회 중" />
                  ) : (
                    <>
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      </span>
                      실시간 주가 조회
                    </>
                  )}
                </button>
              )}
              {stockPriceMeta && (
                <p className="text-[11px] leading-tight text-slate-400">
                  {stockPriceMeta.isMarketOpen
                    ? "장중 실시간 체결가"
                    : "장마감 · 최종 체결가"}
                  {stockPriceMeta.tradedAt &&
                    ` · ${new Date(
                      stockPriceMeta.tradedAt
                    ).toLocaleString("ko-KR", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })} 기준`}
                </p>
              )}
            </div>

            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {valuationRatios.map((ratio) => (
                <li key={ratio.label} className="text-xs leading-5">
                  <span className="block truncate text-slate-600">
                    {ratio.label}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      ratio.value == null
                        ? "text-slate-400"
                        : "text-slate-900"
                    }`}
                  >
                    {formatRatioValue(ratio.value, ratio.unit)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {crossChecks.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-800">
              교차검증 위험 신호
            </p>
            <ul className="mt-1 space-y-1">
              {crossChecks.map((flag) => (
                <li key={flag.label} className="text-xs text-amber-800">
                  ⚠ {flag.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
  );
}
