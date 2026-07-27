import "server-only";
import fs from "fs";
import path from "path";
import { fetchFinancialStatements } from "./dart";
import { calculateRatios } from "./ratios";

// FR-2.4 동종업계(KSIC) 평균 비교. 상장사 업종코드 인덱스(빌드타임 생성·커밋:
// data/listed-industry.json)에서 같은 업종 상장사를 찾아, 표본으로 재무비율
// 평균을 산출한다. 런타임 DART 호출 비용을 억제하기 위해 표본 수를 제한하고
// (업종코드·연도·보고서·재무제표종류) 조합별로 인메모리 캐시한다.

export type IndustryEntry = {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  induty_code: string;
};

const INDEX_PATH = path.join(process.cwd(), "data", "listed-industry.json");
const PEER_SAMPLE_SIZE = 8;

let indexCache: IndustryEntry[] | null | undefined;

function loadIndex(): IndustryEntry[] | null {
  if (indexCache !== undefined) return indexCache;
  let loaded: IndustryEntry[] | null;
  try {
    loaded = fs.existsSync(INDEX_PATH)
      ? (JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8")) as IndustryEntry[])
      : null;
  } catch {
    loaded = null;
  }
  indexCache = loaded;
  return loaded;
}

export function isIndustryIndexAvailable(): boolean {
  const idx = loadIndex();
  return Array.isArray(idx) && idx.length > 0;
}

function getIndutyCode(corpCode: string): string | null {
  const idx = loadIndex();
  if (!idx) return null;
  const hit = idx.find((e) => e.corp_code === corpCode);
  return hit ? hit.induty_code : null;
}

function findPeers(
  indutyCode: string,
  excludeCorpCode: string
): IndustryEntry[] {
  const idx = loadIndex();
  if (!idx) return [];
  return idx.filter(
    (e) => e.induty_code === indutyCode && e.corp_code !== excludeCorpCode
  );
}

export type IndustryAverage = {
  available: boolean;
  indutyCode: string | null;
  peerTotal: number;
  sampleUsed: number;
  averagesByLabel: Record<string, number>;
  note?: string;
};

const cache = new Map<string, IndustryAverage>();

/**
 * 대상 회사와 같은 업종(induty_code) 상장사들의 재무비율 평균을 산출한다.
 * 표본(최대 8곳)의 재무제표를 조회해 비율을 계산하고 지표별 평균을 낸다.
 */
export async function getIndustryAverage(params: {
  corpCode: string;
  bsnsYear: string;
  reprtCode: string;
  fsDiv: "OFS" | "CFS";
}): Promise<IndustryAverage> {
  const { corpCode, bsnsYear, reprtCode, fsDiv } = params;

  if (!isIndustryIndexAvailable()) {
    return {
      available: false,
      indutyCode: null,
      peerTotal: 0,
      sampleUsed: 0,
      averagesByLabel: {},
      note: "업종 인덱스가 아직 준비되지 않았습니다.",
    };
  }

  const indutyCode = getIndutyCode(corpCode);
  if (!indutyCode) {
    return {
      available: false,
      indutyCode: null,
      peerTotal: 0,
      sampleUsed: 0,
      averagesByLabel: {},
      note: "대상 회사의 업종코드를 찾지 못했습니다(상장사 목록 밖).",
    };
  }

  const cacheKey = `${indutyCode}|${bsnsYear}|${reprtCode}|${fsDiv}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const peers = findPeers(indutyCode, corpCode);
  const sample = peers.slice(0, PEER_SAMPLE_SIZE);

  // 표본 상장사 재무제표를 병렬 조회 후 비율 계산 (실패한 곳은 건너뜀)
  const settled = await Promise.allSettled(
    sample.map(async (peer) => {
      const fin = await fetchFinancialStatements(
        peer.corp_code,
        bsnsYear,
        reprtCode,
        fsDiv
      );
      return calculateRatios(fin);
    })
  );

  const sums: Record<string, { total: number; count: number }> = {};
  let sampleUsed = 0;
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    sampleUsed += 1;
    for (const group of s.value) {
      for (const r of group.ratios) {
        if (r.value == null || !Number.isFinite(r.value)) continue;
        if (!sums[r.label]) sums[r.label] = { total: 0, count: 0 };
        sums[r.label].total += r.value;
        sums[r.label].count += 1;
      }
    }
  }

  const averagesByLabel: Record<string, number> = {};
  for (const [label, { total, count }] of Object.entries(sums)) {
    if (count > 0) averagesByLabel[label] = total / count;
  }

  const result: IndustryAverage = {
    available: sampleUsed > 0,
    indutyCode,
    peerTotal: peers.length,
    sampleUsed,
    averagesByLabel,
    note:
      sampleUsed === 0
        ? "동종업종 상장사 재무제표를 조회하지 못했습니다."
        : undefined,
  };
  if (sampleUsed > 0) cache.set(cacheKey, result);
  return result;
}
