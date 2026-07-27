// 기준서 챗봇 코퍼스 임베딩 인제스천. data/standards-source.json의 각 문서를
// Upstage 임베딩(embedding-passage, 4096차원)으로 변환해 data/standards-corpus.json
// 으로 굽는다. 코퍼스가 작아(수십 건) 벡터DB 없이 런타임 인메모리 코사인 검색을
// 쓰므로, 임베딩을 미리 계산해 커밋한다.
//
//   실행: node scripts/ingest-standards.js   (UPSTAGE_API_KEY는 .env.local에서 로드)
const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, "..", ".env.local");
const SRC_PATH = path.join(__dirname, "..", "data", "standards-source.json");
const OUT_PATH = path.join(__dirname, "..", "data", "standards-corpus.json");
const EMBED_URL = "https://api.upstage.ai/v1/embeddings";

function loadEnv(key) {
  if (process.env[key]) return process.env[key];
  try {
    const txt = fs.readFileSync(ENV_PATH, "utf-8");
    const m = txt.match(new RegExp(`^${key}=(.*)$`, "m"));
    if (m) return m[1].trim().replace(/^"|"$/g, "").replace(/\r$/, "");
  } catch {}
  return null;
}

async function embed(apiKey, text) {
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "embedding-passage", input: text }),
  });
  if (!res.ok) throw new Error(`임베딩 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  return d.data[0].embedding;
}

async function main() {
  const apiKey = loadEnv("UPSTAGE_API_KEY");
  if (!apiKey) throw new Error("UPSTAGE_API_KEY 없음(.env.local 확인)");

  const src = JSON.parse(fs.readFileSync(SRC_PATH, "utf-8"));
  const docs = src.docs;
  console.log(`[ingest-standards] ${docs.length}개 문서 임베딩 시작...`);

  const out = [];
  for (const doc of docs) {
    // 검색 품질을 위해 제목·본문·키워드를 합쳐 임베딩한다.
    const passage = `[${doc.category} ${doc.code}] ${doc.title}. ${doc.content} 키워드: ${(doc.keywords || []).join(", ")}`;
    const embedding = await embed(apiKey, passage);
    out.push({
      code: doc.code,
      category: doc.category,
      title: doc.title,
      content: doc.content,
      keywords: doc.keywords || [],
      embedding,
    });
    console.log(`  ✓ ${doc.category} ${doc.code} ${doc.title}`);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out), "utf-8");
  const mb = (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(2);
  console.log(`[ingest-standards] 완료: ${out.length}개 → ${OUT_PATH} (${mb}MB, dim=${out[0].embedding.length})`);
}

main().catch((e) => {
  console.error("[ingest-standards] 실패:", e.message);
  process.exit(1);
});
