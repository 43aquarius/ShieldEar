/**
 * GET /api/evidence/[caseNo]?kind=evidence|source — 证据音频/原始来源下载
 * v1.3.9：kind=source 服务 {caseNo}_source.bin（原始上传/合成产物，任意格式），
 * 按案例记录的原始文件名与对应 MIME 下发；kind=evidence 恒为 16kHz WAV。
 */
import { NextRequest, NextResponse } from "next/server";
import { readEvidence } from "@/lib/server/case-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extToMime(name: string | null): string {
  const ext = (name ?? "").split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "ogg":
    case "opus":
      return "audio/ogg";
    case "webm":
      return "audio/webm";
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

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
      return NextResponse.json(
        { error: kind === "source" ? "原始来源文件不存在（该案例未随证保留原件）" : "证据音频不存在" },
        { status: 404 }
      );
    }
    // kind=source：按案例记录的原始文件名与真实 MIME 下发
    let filename = `${caseNo}_${kind}.wav`;
    let mime = "audio/wav";
    if (kind === "source") {
      const rec = await db.detectionCase.findUnique({
        where: { caseNo },
        select: { fileName: true },
      });
      const safe = (rec?.fileName ?? "").replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
      filename = safe || `${caseNo}_source.bin`;
      mime = extToMime(rec?.fileName ?? null);
    }
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": buf.length.toString(),
        // RFC 5987：中文文件名用 filename* 编码，兼容旧代理的 ASCII 回退名
        "Content-Disposition":
          `attachment; filename="${encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}"; ` +
          `filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/evidence] error:", err);
    return NextResponse.json({ error: "读取证据失败" }, { status: 500 });
  }
}
