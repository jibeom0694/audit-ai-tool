import { extractFinancialHighlights } from "@/lib/upstage";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "파일이 없습니다." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const highlights = await extractFinancialHighlights(
      buffer,
      file.type || "application/pdf"
    );
    return Response.json({ highlights });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 500 });
  }
}
