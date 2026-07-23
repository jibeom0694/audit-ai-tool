// data/corp-codes.json(DART 회사코드 전체 목록)을 받아두는 스크립트.
//
// 이 파일은 git에 커밋된 스냅샷이 기본이다 — Vercel(미국 리전) 빌드머신에서
// DART의 corpCode.xml(118,000+건, 압축 후에도 수 MB)을 받으면 국내망 대비 극도로
// 느려(수 분) 배포마다 그 비용을 반복하게 된다. 게다가 서버리스 함수는 배포 후
// 파일시스템이 읽기 전용이라 런타임에 캐싱을 시도해도 매 요청마다 재다운로드를
// 시도하다 함수 실행시간 제한을 넘겨 /api/dart/search가 응답 없이 멈추는 원인이
// 됐었다. 그래서 이 파일은 커밋해두고, dart.ts의 loadCorpCodes()는 그냥 읽기만
// 한다. 이 스크립트는 파일이 없을 때만(최초 생성) 또는 FORCE_REFRESH=1로 명시
// 실행했을 때만(수동 최신화) 실제로 DART에서 다시 받는다 — 매 빌드에 자동으로
// 다시 받지 않는다는 뜻이다. 최신화가 필요하면 한국 네트워크에서
// `FORCE_REFRESH=1 node scripts/build-corp-codes.js`를 실행해 다시 커밋하면 된다.
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { XMLParser } = require("fast-xml-parser");

const BASE_URL = "https://opendart.fss.or.kr/api";
const CACHE_PATH = path.join(__dirname, "..", "data", "corp-codes.json");

async function main() {
  if (fs.existsSync(CACHE_PATH) && !process.env.FORCE_REFRESH) {
    console.log(
      "[build-corp-codes] 커밋된 corp-codes.json을 그대로 사용합니다 (재다운로드 건너뜀). " +
        "최신화하려면 FORCE_REFRESH=1 node scripts/build-corp-codes.js 로 실행하세요."
    );
    return;
  }

  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    console.warn(
      "[build-corp-codes] DART_API_KEY가 없어 corp-codes.json 생성을 건너뜁니다. " +
        "런타임에 최초 요청 시점에 다시 시도됩니다(로컬 개발 환경에서는 정상 동작)."
    );
    return;
  }

  console.log("[build-corp-codes] DART corpCode.xml 다운로드 중...");
  const res = await fetch(
    `${BASE_URL}/corpCode.xml?crtfc_key=${encodeURIComponent(apiKey)}`
  );
  if (!res.ok) {
    throw new Error(`DART corpCode 요청 실패: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("CORPCODE.xml");
  if (!entry) {
    throw new Error("CORPCODE.xml 항목을 찾을 수 없습니다.");
  }

  const xml = entry.getData().toString("utf-8");
  const parser = new XMLParser({ parseTagValue: false });
  const parsed = parser.parse(xml);
  const rawList = parsed?.result?.list ?? [];
  const list = Array.isArray(rawList) ? rawList : [rawList];

  const corpCodes = list.map((item) => ({
    corp_code: String(item.corp_code ?? ""),
    corp_name: String(item.corp_name ?? ""),
    stock_code: String(item.stock_code ?? "").trim(),
    modify_date: String(item.modify_date ?? ""),
  }));

  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(corpCodes), "utf-8");
  console.log(
    `[build-corp-codes] ${corpCodes.length.toLocaleString()}건 저장 완료: ${CACHE_PATH}`
  );
}

main().catch((err) => {
  console.error("[build-corp-codes] 실패:", err.message);
  console.error(
    "[build-corp-codes] corp-codes.json 없이 빌드를 계속합니다 — 런타임 최초 요청 시 다운로드를 시도합니다."
  );
});
