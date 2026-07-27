import { getIndustryAverage } from "@/lib/industry";

// FR-2.4 동종업계(KSIC) 평균 비교. 상장(DART) 경로에서만 의미가 있다.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const corpCode = searchParams.get("corp_code") ?? "";
  const bsnsYear = searchParams.get("bsns_year") ?? "";
  const reprtCode = searchParams.get("reprt_code") ?? "";
  const fsDiv = (searchParams.get("fs_div") ?? "OFS") as "OFS" | "CFS";

  if (!corpCode || !bsnsYear || !reprtCode) {
    return Response.json(
      { error: "corp_code·bsns_year·reprt_code가 필요합니다." },
      { status: 400 }
    );
  }

  try {
    const result = await getIndustryAverage({
      corpCode,
      bsnsYear,
      reprtCode,
      fsDiv,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
