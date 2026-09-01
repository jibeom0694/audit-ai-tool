# CLAUDE.md

이 파일은 이 저장소에서 작업할 때 Claude Code(claude.ai/code)에게 제공되는 가이드입니다.

## 저장소 구조 — 가장 먼저 읽어야 할 내용

이 디렉토리에는 **서로 무관한 두 가지**가 섞여 있습니다:

- **`web/`** — 실제로 활성화된 프로젝트. Next.js 16(App Router, TypeScript, Tailwind v4) 앱입니다. 실제 개발은 전부 여기서 이루어집니다.
- **그 외 루트에 있는 것들** (`app.py`, `src/`, `venv/`, `requirements.txt`, `templates/`, `scripts/make_template.py`, 루트의 `data/`) — 스택을 Next.js/Supabase/Vercel/Upstage로 전환하기 전, 프로젝트 첫날에 만들었던 **폐기된 Python/Streamlit 프로토타입**입니다. 참고용으로만 남겨둔 것이니 확장하지 말고, 실행 가능하다고 가정하지도 마세요.
- `PRD.md` — 전체 제품 명세(FR-1~FR-13 기능요구사항, 기술스택 결정사항, 범위, 범위 제외 항목 포함). 기능을 추가하기 전에 반드시 읽으세요 — 지금의 범위가 *왜* 이렇게 정해졌는지가 기록되어 있습니다(예: 엑셀 템플릿을 왜 고정 스키마로 했는지, 어떤 기능을 왜 의도적으로 제외했는지). 각 FR 하단의 `구현 메모`가 초안과 실제 구현이 갈라진 지점과 그 사유를 담고 있으니, 초안 본문만 읽고 판단하지 마세요.
- `브레인스토밍.txt` / `브레인스토밍1.txt` — PRD 이전의 초기 한글 기획 메모.

아래 명령어들은 별도 언급이 없는 한 모두 `cd web`을 먼저 실행했다고 가정합니다.

## 명령어

```bash
cd web
npm run dev        # next dev — 개발 서버 실행
npm run build      # next build
npm run start      # next start (프로덕션 빌드 서빙)
npm run lint       # eslint
npm test           # vitest run — 도메인 로직 회귀 테스트
npm run test:watch # vitest (watch 모드)
```

**이 환경 특유의 주의사항**: 새로 띄운 셸에는 Node.js가 PATH에 안 잡혀 있을 수 있습니다(셸/하네스 프로세스가 시작된 이후에 Node.js가 설치됐기 때문). `node`/`npm`이 "인식할 수 없다"고 나오면 먼저 해당 셸에서 PATH를 새로고침하세요:
```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

**저장소 루트에서 그냥 `npm run dev`로 개발 서버를 띄우지 마세요** — `web/scripts/start-dev.js`는 Next의 CLI를 `node.exe`로 직접 실행하기 전에 `process.chdir()`로 `web/`로 이동하기 위해 존재하는 파일입니다. `src/lib/dart.ts`의 디스크 캐시 경로가 `process.cwd()` 기준으로 결정되기 때문에, 잘못된 디렉토리에서 실행하면 캐시가 엉뚱한 곳에 조용히 저장됩니다. `.claude/launch.json`의 `web-app` 설정이 이미 이 스크립트를 가리키고 있으니, 툴링을 통해 서버를 띄울 때는 임의로 `npm run dev`를 실행하기보다 이 설정을 사용하세요.

## 테스트

`web/src/lib/__tests__/`에 도메인 순수함수 회귀 테스트 145건이 있습니다(vitest). 재무비율·계정 별칭 해석·Benford·Beneish·Altman·RSF·라운드트립·전표(JE) 8종·시산표 검증·MUS·중요성·미수정왜곡 집계·ISA 인용 화이트리스트를 덮습니다.

**이 스위트에 없는 것**: UI(`page.tsx`)와 외부 연동(DART·Upstage·Supabase). 후자는 API 키·네트워크가 필요하고 `server-only`로 잠겨 있어 노드 테스트 환경에서 로드조차 되지 않습니다. 이 모듈들(`dart.ts`, `upstage.ts`, `standardsRag.ts`, `industry.ts`, `auditStore.ts`, `supabaseServer.ts`)을 테스트에서 import하지 마세요.

도메인 로직(`src/lib/`)을 고칠 때는 테스트를 함께 갱신하세요 — 감사 판단 기준이 들어 있는 곳이라 조용한 회귀가 가장 위험합니다.

**알려진 잔여 lint 오류 2건**: `page.tsx`의 "setState synchronously within an effect"(음성인식 지원 감지 / 검색 디바운스). 둘 다 SSR 불일치 방지와 입력 리셋을 위한 의도적 패턴이라 그대로 뒀습니다. 새 오류를 추가하지 마세요.

## 배포

- Vercel 배포는 사용자가 명시적으로 "배포해줘"라고 요청했을 때만 실행한다. 코드를 수정했다고 해서 자동으로 배포하지 않는다.
- ⚠️ 단, **GitHub 저장소에 push하면 Vercel이 자동으로 배포**합니다(Git 연동). 즉 위 규칙은 실질적으로 "commit·push를 사용자 요청 없이 하지 않는다"로 지켜야 의미가 있습니다. 이 충돌은 PRD §13에 미해결 사항으로 올라가 있습니다.
- Vercel 프로젝트의 Root Directory가 `web`이라, CLI 배포 시 `vercel --prod`는 **저장소 루트에서** 실행해야 합니다(`web/`에서 실행하면 경로가 `web/web`으로 중복돼 실패).

## 아키텍처

**서버 저장은 선택 사항입니다.** `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`가 설정돼 있으면 분석 요청이 Supabase에 저장되고 삭제도 soft delete + 이벤트 기록으로 증적이 남습니다(`auditStore.ts` / `auditClient.ts` / `supabase/schema.sql`). 설정돼 있지 않으면 코드가 자동으로 브라우저 `localStorage`(`audit-ai-demo-requests`) 폴백으로 동작합니다 — **환경변수 없이도 전 기능이 동작하는 것이 기본값**입니다. 어느 모드에서든 거래 단위 원장(전표·시산표)은 서버로 보내지도, localStorage에 쓰지도 않고 메모리에만 유지합니다(기밀성).

**독립적인 3가지 데이터 입력 경로**가 `web/src/app/page.tsx`의 3단 토글(`inputMode: "dart" | "excel" | "upstage"`)로 구현되어 있습니다:

1. **DART 검색** (상장기업) — 클라이언트에서 350ms 디바운스로 `GET /api/dart/search?q=...`를 호출하며, 이는 `web/src/lib/dart.ts`가 처리합니다:
   - `fetchCorpCodesFromDart()`가 DART의 압축된 `CORPCODE.xml`을 내려받고(`DART_API_KEY` 필요), `adm-zip`으로 압축을 풀고 `fast-xml-parser`로 파싱합니다. 이때 `parseTagValue: false` 옵션이 핵심입니다 — 이게 없으면 `corp_code`/`stock_code`의 앞자리 0(예: `"00126380"`)이 숫자로 자동 변환되면서 조용히 손상됩니다.
   - `loadCorpCodes()`는 파싱된 목록을 `data/corp-codes.json`에 캐싱해서 매 요청마다 재다운로드하지 않습니다(경로가 `process.cwd()` 기준이라는 점은 위 start-dev.js 관련 주의사항 참고).
   - `searchCorpCodes()`는 `corp_name` 부분일치 검색을 하며, 상장사(종목코드가 있는 곳)를 먼저 정렬합니다.

2. **엑셀 템플릿 업로드** (비상장기업, 정형 경로) — `web/src/lib/excelTemplate.ts`가 고정 스키마(`STATEMENT_SHEETS`: 재무상태표/손익계산서/현금흐름표, 그리고 전표데이터 시트)를 정의하고, 템플릿 생성기(`GET /api/template`, `xlsx` 패키지로 .xlsx 생성)와 파서가 이 스키마를 공유합니다. 업로드된 파일은 `web/src/lib/excelParse.ts`의 `parseFinancialTemplate()`로 **완전히 클라이언트 측에서** 파싱되며, 서버로는 아무것도 전송되지 않습니다. 회사마다 계정과목명 관행이 달라서 자유 형식 파싱은 신뢰하기 어렵기 때문에 스키마를 의도적으로 고정해뒀습니다(PRD의 FR-1.3 근거 참고).

3. **AI 이미지/PDF 자동인식** (비상장기업, 비정형 경로) — `POST /api/upstage/extract`가 업로드된 파일을 받아 `web/src/lib/upstage.ts`의 `extractFinancialHighlights()`를 호출하고, 이 함수가 Upstage의 Information Extraction API(`UPSTAGE_API_KEY` 필요)에 평평한(flat) JSON 스키마로 요청을 보냅니다(이 API가 중첩 객체를 지원하지 않아서, `자산총계_당기`/`자산총계_전기`처럼 필드명을 중첩 대신 접미사로 구분함). 추출된 영업이익/당기순이익은 손익계산서 산식으로 재계산한 값과 클라이언트 측에서 교차검증됩니다(`page.tsx`의 `checkIncomeStatement()`: 영업이익 = 매출액 − 매출원가 − 판관비; 당기순이익 = 영업이익 + 영업외수익 − 영업외비용 − 법인세비용). 재계산값이 인식값과 `MISMATCH_TOLERANCE` 이상 차이나면 ⚠ 표시와 빨간색으로 경고합니다.

세 경로 모두 `financials.ts`의 동일한 구조(`NormalizedFinancials`)로 정규화된 뒤 `requests` 목록에 들어가므로, 후속 분석 로직은 입력 출처와 무관하게 동작합니다.

**계정명 매칭 주의**: 출처마다 계정 표기가 달라(`ACCOUNT_ALIASES`) 공백 무시 부분일치로 찾습니다. 두 가지 함정이 있습니다 — ① 합계행 후보를 별칭 배열 앞에 둬야 합니다(`유동자산`만 찾으면 `기타유동자산`이 먼저 걸립니다). ② **영업외수익·영업외비용은 DART가 `기타수익`/`금융수익`처럼 쪼개서 주므로 첫 매칭 하나만 집으면 나머지가 통째로 누락됩니다.** 그래서 이 둘만 "합계행이 있으면 그 행, 없으면 구성계정 합산"으로 읽습니다(`ADDITIVE_ACCOUNTS`). 비슷하게 쪼개져 오는 개념을 새로 다룰 때는 이 목록에 추가하세요.

**분석 패널 탭 구조** (`AnalysisDetail`의 `activeTab`) — 성격에 따라 두 그룹:
- **재무제표 스크리닝**(공개·요약 데이터): `ratio` 재무비율 / `anomaly` 이상탐지 / `disclosure` AI 공시요약
- **감사 실무**(클라이언트 원장): `materiality` 중요성 산정(ISA 320) / `tb` 시산표 검증 / `je` 전표 테스트(ISA 240) / `mus` MUS 샘플링 / `sum` 미수정왜곡 집계(ISA 450) / `checklist` 감사 체크리스트 / `dashboard` 대시보드·리포트

**도메인 로직 위치** — 계산은 전부 `src/lib/`의 순수함수이고 `page.tsx`는 표시만 합니다: `ratios.ts`(비율·증감·교차검증), `anomalyDetection.ts`(Benford/Beneish/Altman Z'/RSF/라운드트립), `journalTests.ts`(ISA 240 8종), `trialBalance.ts`, `musSampling.ts`, `materiality.ts`, `misstatements.ts`, `reportExport.ts`, `isaStandards.ts`(ISA 화이트리스트), `standardsRag.ts`(챗봇 RAG), `industry.ts`(산업평균 — 아래 참고).

**LLM 산출물은 반드시 화이트리스트로 거르세요.** LLM이 실재하지 않는 기준서를 인용한 사례가 있어(`ISA 515`, `ISA 541`), `isaStandards.ts`의 `resolveIsaReference()`가 API 응답 단계와 렌더링 단계에서 두 번 차단합니다. 프롬프트 제한은 방어선이 아닙니다. 앞뒤에 숫자가 더 붙지 않은 3자리만 인정합니다(`ISA 2400`이 `240`으로 잘려 통과하는 것을 막기 위함).

**`industry.ts`(FR-2.4 산업평균)는 코드만 있고 비활성입니다** — 읽어야 할 `web/data/listed-industry.json`이 저장소에 없어 항상 "업종 인덱스가 아직 준비되지 않았습니다"를 반환합니다. 켜려면 DART 키를 넣고 `cd web && node scripts/build-listed-industry.js`를 1회 실행해 인덱스를 만들어 커밋하면 됩니다.

**필요한 환경변수** (`web/.env.local`, 커밋되지 않음 — `.env.example` 참고):
- `DART_API_KEY`, `UPSTAGE_API_KEY` — DART 조회와 AI 기능에 필요. 없으면 해당 기능만 오류를 표시하고 나머지는 정상 동작합니다(기업명 검색은 커밋된 `data/corp-codes.json` 스냅샷으로 키 없이도 됩니다).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — 선택. 없으면 localStorage 폴백. service_role 키에 `NEXT_PUBLIC_` 접두사를 절대 붙이지 마세요.

**제3자 AI 전송은 동의 게이트를 통과해야 합니다.** Upstage로 데이터를 보내는 모든 경로(자동인식·체크리스트·공시요약·챗봇)는 `aiConsent.ts`의 `ensureThirdPartyAiConsent()`를 먼저 호출해야 합니다. 새 AI 기능을 추가할 때 이 호출을 빠뜨리면 게이트에 구멍이 생깁니다. 감사대상 회사명은 LLM 프롬프트에 넣지 않습니다.

**`web/AGENTS.md`** (`create-next-app`이 자동 생성한 파일이며, `web/CLAUDE.md`에서 `@AGENTS.md`로 참조됨)는 이 Next.js 버전이 학습 데이터와 다를 수 있으니 코드를 작성하기 전에 `node_modules/next/dist/docs/`를 확인하라고 안내합니다 — 실제로 이번 프로젝트에서 이 조언이 정확했던 사례(Route Handler, App Router 관례 등)가 있었으니, 확신이 서지 않을 때는 이 안내를 따르세요.
