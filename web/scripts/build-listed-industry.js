// 상장사 업종코드(KSIC/induty_code) 인덱스를 미리 만들어 data/listed-industry.json에
// 저장한다. FR-2.4(동종업계 평균 비교)에서 "같은 업종 상장사"를 찾으려면 회사별
// 업종코드가 필요한데, DART엔 업종별 회사목록 API가 없어 company.json을 회사마다
// 호출해 인덱싱해야 한다. 호출 수가 많아(상장사 ~4천) Vercel(미국) 빌드에서 돌리면
// 매우 느리므로, corp-codes.json처럼 한국망 로컬에서 만들어 git에 커밋한다.
//
//   실행: DART_API_KEY=... node --use-system-ca scripts/build-listed-industry.js
//   갱신: FORCE_REFRESH=1 을 함께 지정
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://opendart.fss.or.kr/api";
const CORP_CODES_PATH = path.join(__dirname, "..", "data", "corp-codes.json");
const OUT_PATH = path.join(__dirname, "..", "data", "listed-industry.json");
const CONCURRENCY = 10;

async function fetchInduty(apiKey, corpCode) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(
        `${BASE_URL}/company.json?crtfc_key=${apiKey}&corp_code=${corpCode}`
      );
      const data = await res.json();
      if (data.status === "000") return String(data.induty_code ?? "").trim();
      // 013(데이터 없음) 등은 재시도 무의미
      if (data.status === "013") return "";
    } catch {
      // 네트워크 오류 → 재시도
    }
  }
  return "";
}

async function main() {
  if (fs.existsSync(OUT_PATH) && !process.env.FORCE_REFRESH) {
    console.log(
      "[build-listed-industry] 커밋된 listed-industry.json 사용(재수집 건너뜀). 갱신은 FORCE_REFRESH=1."
    );
    return;
  }
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    console.warn("[build-listed-industry] DART_API_KEY 없음 — 건너뜀");
    return;
  }
  if (!fs.existsSync(CORP_CODES_PATH)) {
    console.warn(
      "[build-listed-industry] corp-codes.json이 없음 — 먼저 build-corp-codes.js 실행 필요"
    );
    return;
  }

  const all = JSON.parse(fs.readFileSync(CORP_CODES_PATH, "utf-8"));
  const listed = all.filter((c) => c.stock_code && c.stock_code.trim());
  console.log(`[build-listed-industry] 상장사 ${listed.length}건 업종코드 수집 시작...`);

  const out = [];
  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < listed.length) {
      const i = cursor++;
      const c = listed[i];
      const induty = await fetchInduty(apiKey, c.corp_code);
      if (induty) {
        out.push({
          corp_code: c.corp_code,
          corp_name: c.corp_name,
          stock_code: c.stock_code,
          induty_code: induty,
        });
      }
      done++;
      if (done % 200 === 0) {
        console.log(`  ...${done}/${listed.length} (수집 ${out.length})`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  out.sort((a, b) => a.corp_code.localeCompare(b.corp_code));
  fs.writeFileSync(OUT_PATH, JSON.stringify(out), "utf-8");
  console.log(
    `[build-listed-industry] 완료: ${out.length}건 저장 → ${OUT_PATH}`
  );
}

main().catch((e) => {
  console.error("[build-listed-industry] 실패:", e.message);
});
