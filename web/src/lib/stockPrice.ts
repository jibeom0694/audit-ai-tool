import "server-only";

export type StockPriceInfo = {
  price: number;
  /** 장중이면 실시간 체결가, 장마감 후면 마지막 체결가(종가) */
  isMarketOpen: boolean;
  /** 이 가격이 실제로 체결된 시각(네이버 증권 기준) */
  tradedAt: string | null;
};

/**
 * PER/PBR 계산용 현재가를 네이버 증권의 공개 시세 API에서 가져온다. 정식
 * 공개 API가 아니라 네이버 모바일 증권 페이지가 내부적으로 쓰는 엔드포인트라
 * 예고 없이 바뀌거나 막힐 수 있음 — 실패하면 사용자가 직접 입력하는 기존
 * 흐름으로 자연스럽게 대체된다(이 함수는 실패 시 null만 반환).
 *
 * 네이버가 내려주는 closePrice는 이름과 달리 장중에는 실시간 체결가로,
 * 장마감 후에는 최종 종가로 계속 갱신되는 "마지막 체결가"다. marketStatus로
 * 장중 여부를 함께 반환해 "실시간"이라는 표현이 실제 데이터 신선도와
 * 어긋나지 않도록 한다.
 */
export async function fetchCurrentStockPrice(
  stockCode: string
): Promise<StockPriceInfo | null> {
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/stock/${stockCode}/basic`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;

    const data = await res.json();
    const raw = data?.closePrice;
    if (raw == null) return null;

    const price = Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(price) || price <= 0) return null;

    return {
      price,
      isMarketOpen: data?.marketStatus === "OPEN",
      tradedAt: typeof data?.localTradedAt === "string" ? data.localTradedAt : null,
    };
  } catch {
    return null;
  }
}
