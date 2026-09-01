"use client";

import type { AccountChange } from "@/lib/ratios";
import {
  amountUnitLabel,
  formatAmountByUnit,
  type AmountUnit,
} from "@/lib/format";

// 재무제표 표시 컴포넌트. 계정 목록을 전기·당기·증감률 표로 그리고, 재무상태표는
// 자산 / 부채·자본 T계정 형태로도 보여준다. 이상 변동 계정 하이라이트는 여기서만
// 그리므로 표시 규칙이 화면마다 갈라지지 않는다.

type BsSide = "asset" | "liability" | "equity";

/** 계정명에 포함된 키워드로 재무상태표 계정을 차변(자산)/대변(부채·자본)으로
 * 분류한다. "부채와자본총계"처럼 양쪽 키워드가 다 있는 합계행은 자산총계와
 * 금액이 같은 중복 합계라 T계정에서는 제외한다. 키워드가 없는 계정(매출채권,
 * 미수금, 예수금 등)은 원본 재무제표 순서상 직전 계정과 같은 변(side)에
 * 속한다고 보고 이어받는다 — DART가 내려주는 ord 순서는 자산 항목들, 자본
 * 항목들, 부채 항목들이 각각 묶여 나열되기 때문에 이 방식이 안전하다. */
export function classifyBsSide(
  accountName: string,
  carried: BsSide
): BsSide | "total" {
  const hasLiability = accountName.includes("부채");
  const hasEquity = accountName.includes("자본");
  if (hasLiability && hasEquity) return "total";
  if (hasEquity) return "equity";
  if (hasLiability) return "liability";
  if (accountName.includes("자산")) return "asset";
  return carried;
}

/** 각 변(side) 안에서 "○○총계" 합계행을 맨 아래로 내린다. DART의 ord 순서는
 * 자산총계·자본총계 같은 합계를 그 구성항목 위에 두는 경우가 있어(예: 자본총계가
 * 자본금·이익잉여금·기타자본항목보다 위), 실제 재무상태표 양식처럼 구성항목을
 * 먼저 나열하고 합계를 맨 아래에 오도록 재정렬한다. */
export function moveTotalsLast(rows: AccountChange[]): AccountChange[] {
  const totals = rows.filter((r) => r.account.includes("총계"));
  const rest = rows.filter((r) => !r.account.includes("총계"));
  return [...rest, ...totals];
}

export function splitBsForTAccount(changes: AccountChange[]) {
  const assets: AccountChange[] = [];
  const liabilities: AccountChange[] = [];
  const equity: AccountChange[] = [];
  let carried: BsSide = "asset";
  for (const c of changes) {
    const side = classifyBsSide(c.account, carried);
    if (side === "total") continue;
    carried = side;
    if (side === "asset") assets.push(c);
    else if (side === "liability") liabilities.push(c);
    else equity.push(c);
  }
  return {
    assets: moveTotalsLast(assets),
    liabilities: moveTotalsLast(liabilities),
    equity: moveTotalsLast(equity),
  };
}

export function TAccountRows({
  changes,
  unit,
  compact = false,
}: {
  changes: AccountChange[];
  unit: AmountUnit;
  compact?: boolean;
}) {
  const textSize = compact ? "text-xs" : "text-sm";
  const cellPad = compact ? "px-2 py-1.5" : "px-3 py-2";
  const unitLabel = amountUnitLabel(unit);
  return (
    <table className={`w-full ${textSize}`}>
      <thead className="sticky top-0 bg-white">
        <tr>
          <th
            className={`border-b border-slate-200 ${cellPad} text-left font-medium text-slate-500`}
          >
            계정과목
          </th>
          <th
            className={`border-b border-slate-200 ${cellPad} text-right font-medium text-slate-500`}
          >
            전기({unitLabel})
          </th>
          <th
            className={`border-b border-slate-200 ${cellPad} text-right font-medium text-slate-500`}
          >
            당기({unitLabel})
          </th>
          <th
            className={`border-b border-slate-200 ${cellPad} text-right font-medium text-slate-500`}
          >
            증감률
          </th>
        </tr>
      </thead>
      <tbody>
        {changes.length === 0 ? (
          <tr>
            <td colSpan={4} className={`${cellPad} text-center text-slate-400`}>
              표시할 계정이 없습니다.
            </td>
          </tr>
        ) : (
          changes.map((c, i) => {
            const isTotal = c.account.includes("총계");
            return (
              <tr
                key={`${c.account}-${i}`}
                className={`${c.isAbnormal ? "bg-red-50" : ""} ${
                  isTotal ? "border-t-2 border-slate-300 bg-slate-50" : ""
                }`}
              >
                <td
                  className={`border-b border-slate-100 ${cellPad} ${
                    isTotal ? "font-bold text-slate-900" : "text-slate-700"
                  }`}
                  style={{ wordBreak: "keep-all" }}
                >
                  {c.account}
                </td>
                <td
                  className={`border-b border-slate-100 ${cellPad} text-right ${
                    isTotal ? "font-bold text-slate-900" : "text-slate-600"
                  }`}
                >
                  {formatAmountByUnit(c.prior, unit)}
                </td>
                <td
                  className={`border-b border-slate-100 ${cellPad} text-right ${
                    isTotal ? "font-bold text-slate-900" : "text-slate-600"
                  }`}
                >
                  {formatAmountByUnit(c.current, unit)}
                </td>
                <td
                  className={`border-b border-slate-100 ${cellPad} text-right font-medium ${
                    c.isAbnormal
                      ? "text-red-600"
                      : isTotal
                        ? "font-bold text-slate-900"
                        : "text-slate-600"
                  }`}
                >
                  {c.changeRate == null
                    ? c.isNew
                      ? "신규"
                      : "-"
                    : `${c.changeRate.toFixed(1)}%`}
                  {c.isAbnormal && " ⚠"}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

/** "재무상태표"/"손익계산서" 버튼을 눌렀을 때 뜨는 큰 화면 모달. 계정 수가
 * 많아도 읽기 편하도록 작은 인라인 테이블보다 글자 크기와 여백을 키운다.
 * 재무상태표는 왼쪽 자산·오른쪽 부채/자본으로 나눈 T계정 형태로, 손익계산서는
 * 단일 목록으로 보여준다. */
export function StatementModal({
  title,
  changes,
  unit,
  layout = "list",
  onClose,
}: {
  title: string;
  changes: AccountChange[];
  unit: AmountUnit;
  layout?: "list" | "t-account";
  onClose: () => void;
}) {
  const { assets, liabilities, equity } =
    layout === "t-account"
      ? splitBsForTAccount(changes)
      : { assets: [], liabilities: [], equity: [] };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[85vh] w-full flex-col rounded-xl bg-white shadow-xl ${
          layout === "t-account" ? "max-w-6xl" : "max-w-3xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h4 className="text-base font-semibold text-slate-900">{title}</h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M18 6 6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {layout === "t-account" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-slate-300">
              <div className="sm:pr-4">
                <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                  자산
                </p>
                <TAccountRows changes={assets} unit={unit} compact />
              </div>
              <div className="mt-4 sm:mt-0 sm:pl-4">
                <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                  부채
                </p>
                <TAccountRows changes={liabilities} unit={unit} compact />
                <p className="mb-1 mt-4 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                  자본
                </p>
                <TAccountRows changes={equity} unit={unit} compact />
              </div>
            </div>
          ) : (
            <TAccountRows changes={changes} unit={unit} />
          )}
        </div>
      </div>
    </div>
  );
}
