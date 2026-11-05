/**
 * GET /api/evidence/[caseNo]?kind=evidence|source — 证据音频下载（WAV）
 */
import { NextRequest, NextResponse } from "next/server";
import { readEvidence } from "@/lib/server/case-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ caseNo: string }> }
) {
  try {
    const { caseNo } = await params;
    const kind =
      req.nextUrl.searchParams.get("kind") === "source" ? "source" : "evidence";
    const buf = readEvidence(caseNo, kind);
    if (!buf) {
      return NextResponse.json({ error: "证据音频不存在" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": buf.length.toString(),
        "Content-Disposition": `attachment; filename="${caseNo}_${kind}.wav"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/evidence] error:", err);
    return NextResponse.json({ error: "读取证据失败" }, { status: 500 });
  }
}
