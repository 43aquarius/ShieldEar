/**
 * GET /api/cases — 案例列表（倒序，最新在前；summary 模式不含逐窗明细）
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const full = url.searchParams.get("full") === "1";
    const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50);

    const cases = await db.detectionCase.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        caseNo: true,
        sourceType: true,
        sourceLabel: true,
        fileName: true,
        durationSec: true,
        audioHash: true,
        sourceHash: true,
        overallRisk: true,
        syntheticRatio: true,
        meanScore: true,
        maxScore: true,
        totalWindows: true,
        voicedWindowCount: true,
        channel: true,
        engineVersion: true,
        rtf: true,
        createdAt: true,
        ...(full
          ? { windows: true, featureProfile: true, segments: true }
          : {}),
      },
    });

    return NextResponse.json({
      cases: cases.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[api/cases] error:", err);
    return NextResponse.json({ error: "读取案例库失败" }, { status: 500 });
  }
}
