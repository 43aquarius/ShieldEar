/**
 * GET /api/selfcheck — 系统自检（v1.3.5；v1.3.11 移除合成通道后为 4 项）
 *
 * 对平台各关键子系统做一次只读体检（仅证据目录做写探针后即刻删除，不发出任何网络请求）：
 *   1. 数据引擎（Prisma + SQLite 连通性）
 *   2. 证据目录（存在且可写）
 *   3. 引擎校准（calibration/features.json 可读）
 *   4. 离线声明（纯离线发行版标识）
 * 每项返回 { name, ok, detail, ms }，前端逐项动画展示。
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { ENGINE_VERSION } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckItem {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

async function timed(
  name: string,
  fn: () => Promise<{ ok: boolean; detail: string }>
): Promise<CheckItem> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { name, ...r, ms: Date.now() - t0 };
  } catch (e) {
    return {
      name,
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      ms: Date.now() - t0,
    };
  }
}

export async function GET() {
  const checks: CheckItem[] = [];

  // 1. 数据引擎（Prisma 客户端加载 + SQLite 查询）
  checks.push(
    await timed("数据引擎", async () => {
      const n = await db.detectionCase.count();
      return { ok: true, detail: `Prisma + SQLite 正常，案例表可查询（现存 ${n} 条）` };
    })
  );

  // 2. 证据目录（写探针验证可写，随即删除）
  checks.push(
    await timed("证据目录", async () => {
      const dir = path.join(process.cwd(), "evidence");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, ".write-probe");
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).length;
      return { ok: true, detail: `evidence/ 可写（现存 ${files} 份证据音频）` };
    })
  );

  // 3. 引擎校准
  checks.push(
    await timed("引擎校准", async () => {
      const p = path.join(process.cwd(), "calibration", "features.json");
      const raw = fs.readFileSync(p, "utf-8");
      const j = JSON.parse(raw) as Record<string, unknown>;
      const keys = Object.keys(j).length;
      return { ok: true, detail: `校准剖面加载成功（${keys} 项特征基准）` };
    })
  );

  // 4. 离线声明（发行标识，非故障项；v1.3.11 起平台不含任何合成/联网通道）
  const releaseOffline = process.env.SHIELD_RELEASE_OFFLINE === "1";
  checks.push({
    name: "离线声明",
    ok: true,
    detail: releaseOffline
      ? "纯离线发行版：检测、存证、核验全程本地运行，零联网"
      : "开发模式（非发行包）：功能与发行版一致，检测全程本地运行",
    ms: 0,
  });

  const passed = checks.filter((c) => c.ok).length;
  return NextResponse.json({
    engineVersion: ENGINE_VERSION,
    releaseOffline,
    platform: process.platform,
    nodeVersion: process.version,
    checks,
    passed,
    total: checks.length,
    allOk: passed === checks.length,
    checkedAt: new Date().toISOString(),
  });
}
