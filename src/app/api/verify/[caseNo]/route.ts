/**
 * GET /api/verify/[caseNo] — 证据完整性核验（v1.3.5）
 *
 * 重新读取该案例的证据 WAV → 重算 SHA-256 → 与入库时记录的哈希逐一比对，
 * 返回逐项核验结果。"存证 → 验真"闭环的验真端：
 * 证明证据自入库以来未被篡改、未损坏、未丢失。
 */
import { NextResponse } from "next/server";
import { verifyEvidenceIntegrity } from "@/lib/server/case-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ caseNo: string }> }
) {
  try {
    const { caseNo } = await params;
    const report = await verifyEvidenceIntegrity(caseNo);
    // 核验"未通过"是一种结论而非服务错误，仍返回 200 携带 verified=false
    return NextResponse.json(report, { status: 200 });
  } catch (err) {
    console.error("[api/verify] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "核验失败" },
      { status: 500 }
    );
  }
}
