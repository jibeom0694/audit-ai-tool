import { fetchCurrentStockPrice } from "@/lib/stockPrice";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return Response.json({ error: "code는 필수입니다." }, { status: 400 });
  }

  const info = await fetchCurrentStockPrice(code);
  if (info == null) {
    return Response.json(
      { error: "시세를 가져오지 못했습니다. 직접 입력해주세요." },
      { status: 502 }
    );
  }

  return Response.json(info);
}
