import "server-only";
import fs from "fs";
import path from "path";
import { callSolarChat } from "./upstageChat";

// 기준서 챗봇 RAG. 커밋된 코퍼스(data/standards-corpus.json, 임베딩 포함)를 메모리에
// 올려두고, 질문을 임베딩해 코사인 유사도로 상위 문서를 검색한 뒤, 그 문서들만
// 근거로 Solar가 답하게 한다. 근거가 약하면 답변을 생성하지 않고 기권한다(환각 차단).

const EMBED_URL = "https://api.upstage.ai/v1/embeddings";
const CORPUS_PATH = path.join(process.cwd(), "data", "standards-corpus.json");
const TOP_K = 4;
// 코사인 유사도 임계값(이 미만이면 관련 근거 없음으로 보고 기권). 경험적으로 보정:
// 유효 감사 질문은 0.32~0.51, 무관 질문(날씨·코딩·요리)은 0.10~0.16로 갈려서
// 그 사이인 0.28로 둔다(유효 질문 오기권 방지 + 무관 질문 확실히 차단).
const MIN_SCORE = 0.28;

export type CorpusDoc = {
  code: string;
  category: string;
  title: string;
  content: string;
  keywords: string[];
  embedding: number[];
};

export type Citation = {
  code: string;
  category: string;
  title: string;
  score: number;
  /** 실제로 근거로 넘긴 요지 본문. 사용자가 인용을 눌렀을 때 "무엇을 근거로
   * 답했는지"를 그대로 보여주기 위해 함께 내려준다. */
  content: string;
};

export type StandardsChatResult = {
  grounded: boolean;
  answer: string;
  citations: Citation[];
  /** 기권했을 때만 채워진다. 왜 못 찾았는지 사용자가 판단할 수 있도록
   * 그래도 가장 가까웠던 후보와 임계값을 함께 보여준다. */
  nearMisses?: Citation[];
  minScore?: number;
};

let corpusCache: CorpusDoc[] | null | undefined;

function loadCorpus(): CorpusDoc[] | null {
  if (corpusCache !== undefined) return corpusCache;
  try {
    corpusCache = fs.existsSync(CORPUS_PATH)
      ? (JSON.parse(fs.readFileSync(CORPUS_PATH, "utf-8")) as CorpusDoc[])
      : null;
  } catch {
    corpusCache = null;
  }
  return corpusCache;
}

export function isCorpusAvailable(): boolean {
  const c = loadCorpus();
  return Array.isArray(c) && c.length > 0;
}

async function embedQuery(query: string): Promise<number[]> {
  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey) throw new Error("UPSTAGE_API_KEY가 설정되어 있지 않습니다.");
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "embedding-query", input: query }),
  });
  if (!res.ok) {
    throw new Error(`임베딩 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const d = await res.json();
  return d.data[0].embedding as number[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const ABSTAIN_ANSWER =
  "수록된 자료(감사기준서 요지)에서 질문과 직접 관련된 기준을 찾지 못했습니다. " +
  "질문을 더 구체적으로 바꿔보시거나, 이 도구가 아직 수록하지 않은 영역(예: 개별 K-IFRS 기준서·질의회신)일 수 있습니다. " +
  "정확한 판단은 원문 기준서와 소속 법인의 지침을 확인하세요.";

const SYSTEM_PROMPT =
  "당신은 한국 회계법인의 감사 기준 리서치 보조자입니다. " +
  "반드시 아래에 제공되는 '수록 자료'에 담긴 내용만 근거로 답하세요. " +
  "자료에 근거가 없는 내용은 절대 지어내지 말고, 기준서 번호·문구를 추측하지 마세요. " +
  "답변은 (1) 어떤 감사기준서를 봐야 하는지(번호·제목 명시), (2) 그 기준의 핵심 논점, " +
  "(3) 실무에서 확인할 포인트 순으로 간결하게 정리하세요. " +
  "제공된 자료로 답하기 어려우면 '수록된 자료에서 관련 기준을 찾지 못했습니다'라고만 답하세요. " +
  "산출물은 참고용이며 원문 기준서 확인이 필요하다는 점을 마지막에 한 줄로 덧붙이세요. " +
  "마크다운 서식(**굵게**, #제목 등)을 쓰지 말고 일반 텍스트로만 답하세요.";

/** 질문에 대해 코퍼스에서 근거를 검색하고, 그 근거로만 Solar가 답하게 한다. */
export async function answerStandardsQuestion(
  query: string
): Promise<StandardsChatResult> {
  const corpus = loadCorpus();
  if (!corpus) {
    return { grounded: false, answer: "기준 코퍼스가 준비되지 않았습니다.", citations: [] };
  }

  const qvec = await embedQuery(query);
  const scored = corpus
    .map((doc) => ({ doc, score: cosine(qvec, doc.embedding) }))
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, TOP_K);
  const best = top[0]?.score ?? 0;

  const toCitation = (t: { doc: CorpusDoc; score: number }): Citation => ({
    code: t.doc.code,
    category: t.doc.category,
    title: t.doc.title,
    score: Number(t.score.toFixed(3)),
    content: t.doc.content,
  });

  // 근거가 약하면 LLM을 부르지 않고 기권(환각 원천 차단). 다만 그냥 "못 찾음"으로
  // 끝내면 사용자가 왜 못 찾았는지 알 수 없어 막다른 길이 되므로, 그래도 가장
  // 가까웠던 후보와 임계값을 함께 돌려준다(질문을 고쳐 쓸 단서 제공).
  if (best < MIN_SCORE) {
    return {
      grounded: false,
      answer: ABSTAIN_ANSWER,
      citations: [],
      nearMisses: top.slice(0, 3).map(toCitation),
      minScore: MIN_SCORE,
    };
  }

  // 임계값을 넘는 문서만 근거로 사용
  const used = top.filter((t) => t.score >= MIN_SCORE);
  const context = used
    .map(
      (t) =>
        `- ISA ${t.doc.code} ${t.doc.title}: ${t.doc.content} (키워드: ${t.doc.keywords.join(", ")})`
    )
    .join("\n");

  const userPrompt = `[질문]\n${query}\n\n[수록 자료 — 이 내용만 근거로 사용]\n${context}`;
  const answer = await callSolarChat(SYSTEM_PROMPT, userPrompt);

  const citations: Citation[] = used.map(toCitation);

  return { grounded: true, answer, citations };
}
