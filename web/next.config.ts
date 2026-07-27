import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // data/corp-codes.json은 next build 전 "prebuild" 스크립트(scripts/build-corp-codes.js)가
  // 미리 받아두는 DART 회사코드 인덱스다. process.cwd() 기준 fs.readFileSync로 읽기 때문에
  // import 추적으로는 안 잡혀서, 서버리스 함수 번들에 명시적으로 포함시켜야 한다. 이게
  // 없으면 Vercel 배포본에는 이 파일이 없어 런타임(첫 요청)에 118,000+건짜리 원본
  // CORPCODE.xml을 매번 재다운로드·재파싱하려다 함수 실행시간 제한을 넘겨 무한 대기하게 된다.
  outputFileTracingIncludes: {
    "/api/dart/*": ["./data/corp-codes.json"],
    // 기준서 챗봇 RAG 코퍼스(임베딩 포함)도 process.cwd() 기준 fs로 읽으므로
    // /api/standards 함수 번들에 명시적으로 포함시킨다.
    "/api/standards/*": ["./data/standards-corpus.json"],
  },
};

export default nextConfig;
