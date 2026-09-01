"use client";

import type { JournalRow } from "@/lib/excelParse";
import type { ReactNode } from "react";
import type {
  AltmanResult,
  BeneishResult,
  BenfordResult,
  RoundTripFlag,
  RsfFlag,
} from "@/lib/anomalyDetection";

const BENFORD_CONFORMITY_LABEL: Record<string, string> = {
  close: "근접 적합(정상)",
  acceptable: "허용 가능(정상)",
  marginal: "경계 — 검토 권장",
  nonconform: "부적합 — 이상",
};

/** 이상탐지 모델 탭. Benford·Beneish·Altman은 재무제표만으로 계산되고,
 * RSF·라운드트립은 전표를 올려야 동작한다. */
export default function AnomalyTab({
  journalUploadBox,
  journalRows,
  beneishResult,
  altmanResult,
  benfordResult,
  rsfFlags,
  roundTripFlags,
}: {
  journalUploadBox: ReactNode;
  journalRows?: JournalRow[];
  beneishResult: BeneishResult | null;
  altmanResult: AltmanResult | null;
  benfordResult: BenfordResult | null;
  rsfFlags: RsfFlag[];
  roundTripFlags: RoundTripFlag[];
}) {
  return (
      <div className="mt-3">
        <p className="text-xs text-slate-400">
          Beneish M-Score·Altman Z&apos;-Score는 재무제표만으로 계산됩니다.
          Benford&apos;s Law·RSF 테스트·라운드트립 탐지는 거래 단위 데이터(전표데이터)가
          있어야 계산되며, 엑셀 업로드가 아닌 DART·AI 인식 항목이라도 아래에서
          전표데이터를 별도로 업로드하면 함께 계산됩니다.
        </p>

        <div className="mt-3">{journalUploadBox}</div>

        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold text-slate-900">
              Beneish M-Score (이익조작 가능성)
            </p>
            {beneishResult ? (
              <>
                <p
                  className={`mt-1 text-lg font-bold ${
                    beneishResult.isSuspicious ? "text-red-600" : "text-slate-900"
                  }`}
                >
                  {beneishResult.score.toFixed(2)}
                  {beneishResult.isSuspicious && " ⚠"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  기준치 −1.78보다{" "}
                  {beneishResult.isSuspicious
                    ? "커서 이익조작 가능성이 높게"
                    : "작아 통상 범위로"}{" "}
                  나타납니다.
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-400">
                데이터 부족 (전기·당기 재무제표 전 항목 및 현금흐름표 필요)
              </p>
            )}
            <p className="mt-1.5 text-[10px] leading-tight text-slate-400">
              ※ 미국 상장 제조업 데이터로 만든 모델이라 국내·비제조·단일기업엔
              오탐이 잦습니다. LVGI에 총부채, TATA에 당기순이익을 대용치로
              씁니다. 부정 확정이 아닌 부정위험 평가(ISA 240) 참고용입니다.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold text-slate-900">
              Altman Z&apos;-Score (부도 가능성)
            </p>
            {altmanResult ? (
              <>
                <p
                  className={`mt-1 text-lg font-bold ${
                    altmanResult.zone === "distress"
                      ? "text-red-600"
                      : altmanResult.zone === "grey"
                        ? "text-amber-600"
                        : "text-slate-900"
                  }`}
                >
                  {altmanResult.score.toFixed(2)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {altmanResult.zone === "safe" && "안전지대 (2.9 초과)"}
                  {altmanResult.zone === "grey" &&
                    "회색지대 (1.23~2.9, 주의 필요)"}
                  {altmanResult.zone === "distress" && "위험지대 (1.23 미만) ⚠"}
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-400">데이터 부족</p>
            )}
            <p className="mt-1.5 text-[10px] leading-tight text-slate-400">
              ※ 제조업용 Z′ 모델을 업종 구분 없이 적용하며, EBIT 대신
              영업이익을 씁니다(서비스업은 Z″가 더 적합). 계속기업(ISA 570)
              조기경보 참고용입니다.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-700">
            Benford&apos;s Law — 거래금액 첫자리 분포
          </p>
          {!journalRows ? (
            <p className="mt-1 text-xs text-slate-400">
              전표데이터가 없습니다. 위에서 업로드하면 계산됩니다.
            </p>
          ) : !benfordResult ? (
            <p className="mt-1 text-xs text-slate-400">
              표본이 30건 미만이라 검정할 수 없습니다.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium text-slate-500">
                      첫자리
                    </th>
                    {benfordResult.digits.map((d) => (
                      <th
                        key={d.digit}
                        className="px-2 py-1.5 text-right font-medium text-slate-500"
                      >
                        {d.digit}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-2 py-1 text-slate-600">실제 %</td>
                    {benfordResult.digits.map((d) => (
                      <td
                        key={d.digit}
                        className="px-2 py-1 text-right text-slate-700"
                      >
                        {d.actualPercent.toFixed(1)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-2 py-1 text-slate-400">기대 %</td>
                    {benfordResult.digits.map((d) => (
                      <td
                        key={d.digit}
                        className="px-2 py-1 text-right text-slate-400"
                      >
                        {d.expectedPercent.toFixed(1)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <div
                className={`border-t border-slate-200 px-2 py-1.5 text-xs ${
                  benfordResult.isSuspicious ? "text-red-600" : "text-slate-500"
                }`}
              >
                <p>
                  표본 {benfordResult.sampleSize.toLocaleString()}건 · 첫자리
                  MAD {benfordResult.mad.toFixed(4)} —{" "}
                  {BENFORD_CONFORMITY_LABEL[benfordResult.conformity]}
                  {benfordResult.isSuspicious && " ⚠"}
                  {benfordResult.sampleSize < 500 && (
                    <span className="text-amber-600">
                      {" "}· 표본이 작아 판정 신뢰도 낮음(수백 건 이상 권장)
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  판정은 표본크기에 좌우되는 카이제곱(참고: {benfordResult.chiSquare.toFixed(1)} / 기준 15.51) 대신
                  표본크기에 무관한 MAD로 내립니다(Nigrini 기준).
                  {benfordResult.firstTwoMad != null &&
                    benfordResult.firstTwoConformity != null && (
                      <>
                        {" "}첫 두 자리 MAD {benfordResult.firstTwoMad.toFixed(4)} —{" "}
                        {BENFORD_CONFORMITY_LABEL[benfordResult.firstTwoConformity]}.
                      </>
                    )}
                  {benfordResult.firstTwoMad == null &&
                    " 첫 두 자리 검정은 표본 300건 이상일 때 표시됩니다."}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-700">
            RSF 테스트 — 계정별 최대금액 이상치
          </p>
          {!journalRows ? (
            <p className="mt-1 text-xs text-slate-400">
              전표데이터가 없습니다. 위에서 업로드하면 계산됩니다.
            </p>
          ) : rsfFlags.length === 0 ? (
            <p className="mt-1 text-xs text-slate-400">
              이상치로 플래그된 계정이 없습니다.
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {rsfFlags.map((f, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs"
                >
                  <p className="font-medium text-slate-700">⚠ {f.account}</p>
                  <p className="mt-0.5 text-slate-600">
                    최대 {f.largest.toLocaleString()} vs 2번째{" "}
                    {f.secondLargest.toLocaleString()} (RSF {f.rsf.toFixed(1)}배)
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-700">
            라운드트립(2자간 상계성 거래) 탐지
          </p>
          {!journalRows ? (
            <p className="mt-1 text-xs text-slate-400">
              전표데이터가 없습니다. 위에서 업로드하면 계산됩니다.
            </p>
          ) : roundTripFlags.length === 0 ? (
            <p className="mt-1 text-xs text-slate-400">
              같은 거래처에 매출과 매입이 유사 금액·근접 시점에 함께 잡히는
              의심 거래가 없습니다.
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {roundTripFlags.map((f, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs"
                >
                  <p className="font-medium text-slate-700">
                    ⚠ 거래처: {f.counterparty} ({f.daysApart}일 간격)
                  </p>
                  <p className="mt-0.5 text-slate-600">
                    매출 {f.saleAmount.toLocaleString()}원 · {f.saleAccount}{" "}
                    ({f.saleDate}) ↔ 매입 {f.purchaseAmount.toLocaleString()}원
                    · {f.purchaseAccount} ({f.purchaseDate})
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  );
}
