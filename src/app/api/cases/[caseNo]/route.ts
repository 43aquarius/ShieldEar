/**
 * GET    /api/cases/[caseNo] — 单个案例完整详情
 * DELETE /api/cases/[caseNo] — 删除案例（同步清理证据文件）
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readEvidence, evidencePath } from "@/lib/server/case-service";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ caseNo: string }> }
) {
  try {
    const { caseNo } = await params;
    const c = await db.detectionCase.findUnique({ where: { caseNo } });
    if (!c) {
      return NextResponse.json({ error: "案例不存在" }, { status: 404 });
    }
    return NextResponse.json({
      case: {
        ...c,
        createdAt: c.createdAt.toISOString(),
        hasEvidenceAudio: !!readEvidence(caseNo, "evidence"),
        hasSourceAudio: !!readEvidence(caseNo, "source"),
      },
    });
  } catch (err) {
    console.error("[api/cases/:caseNo] error:", err);
    return NextResponse.json({ error: "读取案例失败" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ caseNo: string }> }
) {
  try {
    const { caseNo } = await params;
    const c = await db.detectionCase.findUnique({ where: { caseNo } });
    if (!c) {
      return NextResponse.json({ error: "案例不存在" }, { status: 404 });
    }
    await db.detectionCase.delete({ where: { caseNo } });
    for (const kind of ["evidence", "source"] as const) {
      const p = evidencePath(caseNo, kind);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/cases/:caseNo] DELETE error:", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
