"use client";

import { useState } from "react";
import IsaStandardModal from "@/components/IsaStandardModal";

type Citation = {
  code: string;
  category: string;
  title: string;
  score: number;
  content: string;
};

type ChatResult = {
  grounded: boolean;
  answer: string;
  citations: Citation[];
  nearMisses?: Citation[];
  minScore?: number;
};

const EXAMPLES = [
  "재고자산 실사에 입회하지 못했는데 어떤 절차와 기준을 봐야 하나요?",
  "거래처가 조회서에 회신을 안 해줍니다. 대체절차 근거가 뭔가요?",
  "계속기업 존속능력에 의문이 있을 때 감사인이 확인할 사항은?",
  "특수관계자 순환거래가 의심됩니다. 관련 감사기준은?",
];

export default function StandardsChat() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChatResult | null>(null);
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/standards/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "요청 중 오류가 발생했습니다.");
      setResult(data as ChatResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(query);
          }}
          rows={3}
          placeholder="감사 이슈나 상황을 입력하세요. 예) 초도감사인데 기초잔액을 어떻게 확인하나요? (Ctrl+Enter로 전송)"
          className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[11px] text-slate-400">
            수록: 감사기준서(ISA) 요지 28종 · 근거기반 답변 + 출처 표시
          </p>
          <button
            type="button"
            onClick={() => ask(query)}
            disabled={loading || !query.trim()}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {loading ? "깊게 생각하는 중..." : "질문하기"}
          </button>
        </div>
      </div>

      {!result && !loading && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setQuery(ex);
                ask(ex);
              }}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {!result.grounded && (
            <p className="mb-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              근거 없음 — 기권
            </p>
          )}
          <div className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
            {result.answer}
          </div>

          {result.citations.length > 0 && (
            <div className="mt-4 border-t border-slate-200 pt-3">
              <p className="text-xs font-semibold text-slate-700">
                근거 출처 (관련도순) · 클릭하면 기준서 내용을 볼 수 있습니다
              </p>
              <ul className="mt-2 space-y-1">
                {result.citations.map((c) => (
                  <li key={c.code}>
                    <button
                      type="button"
                      onClick={() => setOpenCitation(c)}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100"
                    >
                      <span className="text-slate-700">
                        <span className="font-semibold text-blue-700 underline decoration-dotted">
                          ISA {c.code}
                        </span>{" "}
                        {c.title}
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-400">
                        관련도 {(c.score * 100).toFixed(0)}%
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 기권했을 때: 그냥 "못 찾음"으로 끝내면 왜 못 찾았는지 알 수 없어
              막다른 길이 된다. 가장 가까웠던 후보와 임계값을 보여줘 질문을
              고쳐 쓸 단서를 준다. */}
          {!result.grounded &&
            result.nearMisses &&
            result.nearMisses.length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <p className="text-xs font-semibold text-slate-700">
                  그래도 가장 가까웠던 기준서
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  아래 후보들은 근거로 삼기에 관련도가 부족했습니다(채택 기준{" "}
                  {((result.minScore ?? 0) * 100).toFixed(0)}% 이상). 찾으시던
                  주제가 아래에 있다면, 그 용어를 넣어 다시 질문해 보세요.
                </p>
                <ul className="mt-2 space-y-1">
                  {result.nearMisses.map((c) => (
                    <li key={c.code}>
                      <button
                        type="button"
                        onClick={() => setOpenCitation(c)}
                        className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100"
                      >
                        <span className="text-slate-600">
                          <span className="font-semibold text-slate-500 underline decoration-dotted">
                            ISA {c.code}
                          </span>{" "}
                          {c.title}
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-400">
                          {(c.score * 100).toFixed(0)}%
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          <p className="mt-3 text-[11px] leading-tight text-slate-400">
            ※ 본 답변은 수록된 감사기준서 요지에 근거한 참고용 안내입니다. 실제
            판단은 원문 기준서와 소속 법인 지침을 확인하세요. (질의회신·개별
            K-IFRS 등은 아직 미수록)
          </p>
        </div>
      )}

      {openCitation && (
        <IsaStandardModal
          reference={`ISA ${openCitation.code}`}
          groundedContent={openCitation.content}
          onClose={() => setOpenCitation(null)}
        />
      )}
    </div>
  );
}
