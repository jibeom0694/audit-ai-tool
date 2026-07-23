// 빌드 타임(prebuild)에 DART corpCode 전체 목록을 미리 받아 data/corp-codes.json에
// 저장해두는 스크립트. Vercel 서버리스 함수는 배포 후 파일시스템이 읽기 전용이라
// 런타임(첫 요청)에 캐싱을 시도하면 매 요청마다 118,000+건짜리 CORPCODE.xml을
// 재다운로드·재파싱하게 되고, 이게 서버리스 함수 실행시간 제한을 넘겨서
// /api/dart/search가 응답 없이 멈추는(hang) 원인이었다. 빌드 시점에 이 파일을
// 만들어 두면 dart.ts의 loadCorpCodes()가 즉시 읽기만 하면 되므로 런타임 다운로드가
// 아예 발생하지 않는다. (web/src/lib/dart.ts의 fetchCorpCodesFromDart와 동일 로직)
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { XMLParser } = require("fast-xml-parser");

const BASE_URL = "https://opendart.fss.or.kr/api";
const CACHE_PATH = path.join(__dirname, "..", "data", "corp-codes.json");

async function main() {
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
