"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AltmanResult, BeneishResult } from "@/lib/anomalyDetection";
import { amountUnitLabel, type AmountUnit } from "@/lib/format";
import LoadingDots from "@/components/LoadingDots";

/** 조서 export 버튼에 붙이는 다운로드 아이콘. */
function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

/** 대시보드 & 리포트 탭. 이상 변동 계정과 Benford 분포를 시각화하고,
 * 분석적검토 조서(초안)를 PDF·Word로 export한다. */
export default function DashboardTab({
  abnormalChartData,
  benfordChartData,
  beneishResult,
  altmanResult,
  unit,
  pdfExporting,
  wordExporting,
  exportError,
  handleExportPdf,
  handleExportWord,
}: {
  abnormalChartData: { account: string; 전기: number; 당기: number }[];
  benfordChartData: { digit: string; 실제: number; 기대: number }[];
  beneishResult: BeneishResult | null;
  altmanResult: AltmanResult | null;
  unit: AmountUnit;
  pdfExporting: boolean;
  wordExporting: boolean;
  exportError: string | null;
  handleExportPdf: () => void;
  handleExportWord: () => void;
}) {
  return (
      <div className="mt-3 space-y-6">
        <div>
          <p className="text-xs font-semibold text-slate-700">
            전기 대비 이상 변동 계정 (상위 {abnormalChartData.length}건)
          </p>
          {abnormalChartData.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">
              이상 변동으로 표시된 계정이 없습니다.
            </p>
          ) : (
            <div className="mt-2 h-72 rounded-lg border border-slate-200 bg-white p-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={abnormalChartData}
                  layout="vertical"
                  margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                  barCategoryGap={10}
                >
                  <CartesianGrid
                    stroke="#e2e8f0"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickFormatter={(v) => v.toLocaleString()}
                  />
                  <YAxis
                    type="category"
                    dataKey="account"
                    width={110}
                    tick={{ fontSize: 11, fill: "#334155" }}
                  />
                  <Tooltip
                    formatter={(v) => Number(v).toLocaleString()}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="전기"
                    fill="#eb6834"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={18}
                  />
                  <Bar
                    dataKey="당기"
                    fill="#2a78d6"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={18}
                  />
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-1 text-[11px] text-slate-400">
                단위: {amountUnitLabel(unit)}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold text-slate-900">
              Beneish M-Score
            </p>
            {beneishResult ? (
              <>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {beneishResult.score.toFixed(2)}
                </p>
                <div className="relative mt-2 h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(0, ((beneishResult.score - -5) / (1 - -5)) * 100))}%`,
                      backgroundColor: beneishResult.isSuspicious
                        ? "#d03b3b"
                        : "#0ca30c",
                    }}
                  />
                  <div
                    className="absolute top-0 h-2 w-px bg-slate-400"
                    style={{
                      left: `${((-1.78 - -5) / (1 - -5)) * 100}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  기준치 −1.78 (회색 선) ·{" "}
                  {beneishResult.isSuspicious
                    ? "이익조작 가능성 높음"
                    : "정상 범위"}
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-400">데이터 부족</p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold text-slate-900">
              Altman Z&apos;-Score
            </p>
            {altmanResult ? (
              <>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {altmanResult.score.toFixed(2)}
                </p>
                <div className="relative mt-2 h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(0, (altmanResult.score / 5) * 100))}%`,
                      backgroundColor:
                        altmanResult.zone === "safe"
                          ? "#0ca30c"
                          : altmanResult.zone === "grey"
                            ? "#fab219"
                            : "#d03b3b",
                    }}
                  />
                  <div
                    className="absolute top-0 h-2 w-px bg-slate-400"
                    style={{ left: `${(1.23 / 5) * 100}%` }}
                  />
                  <div
                    className="absolute top-0 h-2 w-px bg-slate-400"
                    style={{ left: `${(2.9 / 5) * 100}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  기준선 1.23 · 2.9 (회색 선) ·{" "}
                  {altmanResult.zone === "safe" && "안전지대"}
                  {altmanResult.zone === "grey" && "회색지대"}
                  {altmanResult.zone === "distress" && "위험지대"}
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-400">데이터 부족</p>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-700">
            Benford&apos;s Law — 실제 vs 기대 분포
          </p>
          {benfordChartData.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">
              전표데이터가 없어 계산할 수 없습니다.
            </p>
          ) : (
            <div className="mt-2 h-64 rounded-lg border border-slate-200 bg-white p-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={benfordChartData}
                  margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
                >
                  <CartesianGrid stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="digit"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    formatter={(v) => `${v}%`}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="실제"
                    fill="#2a78d6"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={22}
                  />
                  <Bar
                    dataKey="기대"
                    fill="#eb6834"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={22}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 pt-4">
          <p className="text-sm font-semibold text-slate-900">
            분석적검토 조서 export (초안)
          </p>
          <p className="mt-1 text-xs text-slate-400">
            조서번호·대상기간·중요성 기준·작성자/검토자 사인란·결론·tickmark
            범례를 갖춘 분석적검토 조서(초안) 형태로 내보냅니다 — 재무비율·
            이상변동계정·이상탐지 모델·(생성된 경우) 감사 체크리스트 포함.
            Word는 검색·편집이 가능해 감사인이 결론·서명을 채워 조서로
            확정하는 용도이고, PDF는 시각 스냅샷입니다. 브라우저에서 바로
            생성·다운로드되며 서버에 저장되지 않습니다.
          </p>
          {/* 이 탭의 최종 산출물이라 둘 다 강조하되, 위 설명대로 실제
              조서로 확정하는 쪽(Word)을 채움형 1순위로 둔다. */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExportWord}
              disabled={wordExporting}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow disabled:cursor-not-allowed disabled:translate-y-0 disabled:bg-slate-300 disabled:shadow-none"
            >
              {wordExporting ? (
                <LoadingDots text="Word 생성 중" />
              ) : (
                <>
                  <DownloadIcon />
                  Word로 내보내기
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={pdfExporting}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-5 py-2.5 text-sm font-semibold text-blue-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-400 hover:bg-blue-100 hover:shadow disabled:cursor-not-allowed disabled:translate-y-0 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
            >
              {pdfExporting ? (
                <LoadingDots text="PDF 생성 중" />
              ) : (
                <>
                  <DownloadIcon />
                  PDF로 내보내기
                </>
              )}
            </button>
          </div>
          {exportError && (
            <p className="mt-2 text-xs text-red-600">{exportError}</p>
          )}
        </div>
      </div>
  );
}
