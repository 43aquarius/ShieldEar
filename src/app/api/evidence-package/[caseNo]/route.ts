/**
 * GET /api/evidence-package/[caseNo] — 单案例存证包离线导出（v1.3.9）
 *
 * v1.3.7 及之前 README 宣称「存证包可离线导出」，实际界面只有
 * window.print()（浏览器打印为 PDF）——能力与宣称不符（真机审计发现 6）。
 * 本路由补上真实能力：一个自包含 ZIP，含
 *   · {caseNo}_evidence.wav   16kHz 证据音频（与入库 SHA-256 锚定）
 *   · {caseNo}_source.*       原始来源文件（上传原件 / TTS 原始产物，如有）
 *   · case-record.json        案例全量记录（判决、逐窗、特征、通道、引擎版本）
 *   · integrity-report.json   导出时刻的完整性核验结果
 *   · SHA256SUMS.txt          包内全部文件的 SHA-256 清单（sha256sum -c 可校）
 *   · README.txt              中文说明（清单、核验方法、生成环境声明）
 * 导出动作本身不改变证据：所有哈希在入库时已固定，此处只做读取与重算比对。
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readEvidence, sha256Hex, verifyEvidenceIntegrity } from "@/lib/server/case-service";
import { buildZip, type ZipEntry } from "@/lib/server/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeName(name: string): string {
  return name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80) || "unnamed";
}

function extOf(name: string | null): string {
  const e = (name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return /^[a-z0-9]{1,5}$/.test(e) ? e : "bin";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ caseNo: string }> }
) {
  try {
    const { caseNo } = await params;
    const rec = await db.detectionCase.findUnique({ where: { caseNo } });
    if (!rec) {
      return NextResponse.json({ error: `案例不存在：${caseNo}` }, { status: 404 });
    }
    const evidence = readEvidence(caseNo, "evidence");
    if (!evidence) {
      return NextResponse.json(
        { error: "证据音频缺失，无法导出存证包（evidence/ 下无对应 WAV）" },
        { status: 404 }
      );
    }
    const source = readEvidence(caseNo, "source");
    const integrity = await verifyEvidenceIntegrity(caseNo);

    const entries: ZipEntry[] = [];
    const evName = `${caseNo}_evidence.wav`;
    entries.push({ name: evName, data: new Uint8Array(evidence) });
    if (source) {
      entries.push({
        name: `${caseNo}_source.${extOf(rec.fileName)}`,
        data: new Uint8Array(source),
      });
    }

    // 案例全量记录（判决、逐窗、特征剖面、分段、通道与引擎版本）
    const record = {
      caseNo: rec.caseNo,
      sourceType: rec.sourceType,
      sourceLabel: rec.sourceLabel,
      fileName: rec.fileName,
      fileSize: rec.fileSize,
      createdAt: rec.createdAt,
      durationSec: rec.durationSec,
      sampleRate: rec.sampleRate,
      audioHash: rec.audioHash,
      sourceHash: rec.sourceHash,
      overallRisk: rec.overallRisk,
      syntheticRatio: rec.syntheticRatio,
      meanScore: rec.meanScore,
      maxScore: rec.maxScore,
      windowCount: rec.windowCount,
      voicedWindowCount: rec.voicedWindowCount,
      totalWindows: rec.totalWindows,
      channel: rec.channel,
      engineVersion: rec.engineVersion,
      rtf: rec.rtf,
      analyzeMs: rec.analyzeMs,
      serverVerified: rec.serverVerified,
      notes: rec.notes,
      windows: rec.windows,
      featureProfile: rec.featureProfile,
      segments: rec.segments,
    };
    entries.push({
      name: "case-record.json",
      data: new TextEncoder().encode(JSON.stringify(record, null, 2)),
    });
    entries.push({
      name: "integrity-report.json",
      data: new TextEncoder().encode(JSON.stringify(integrity, null, 2)),
    });

    const sums = entries.map((e) => `${sha256Hex(e.data)}  ${e.name}`);
    entries.push({
      name: "SHA256SUMS.txt",
      data: new TextEncoder().encode(sums.join("\n") + "\n"),
    });

    const readme = [
      `声盾 ShieldEar 存证包 — ${caseNo}`,
      "════════════════════════════════════════════",
      "",
      "一、内容清单",
      `  ${evName}          16kHz 证据音频（入库时已做 SHA-256 固定）`,
      source
        ? `  ${caseNo}_source.${extOf(rec.fileName)}    原始来源文件（如有）`
        : "  （本案例未随证保留原始来源文件）",
      "  case-record.json        案例全量记录（判决/逐窗/特征/通道/引擎版本）",
      "  integrity-report.json   导出时刻的完整性核验结果",
      "  SHA256SUMS.txt          包内全部文件的 SHA-256 清单",
      "",
      "二、如何核验",
      "  1. 解包后在本目录执行：sha256sum -c SHA256SUMS.txt",
      "     （Windows 可用 certutil -hashfile <文件> SHA256 逐个比对，",
      "       或 PowerShell 的 Get-FileHash）",
      "  2. 与平台「证据核验」结果一致：evidence WAV 的 SHA-256 应等于",
      `     case-record.json 中的 audioHash（${String(rec.audioHash).slice(0, 16)}…）`,
      "",
      "三、生成环境声明",
      `  导出时间：${new Date().toISOString()}`,
      `  检测引擎：${rec.engineVersion}（离线本地计算，无云端参与）`,
      "  本包由声盾平台本地生成，全程未发出任何网络请求。",
    ].join("\n");
    entries.push({ name: "README.txt", data: new TextEncoder().encode(readme) });

    const zip = buildZip(entries);
    const zipName = `ShieldEar-存证包-${caseNo}.zip`;
    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": zip.length.toString(),
        "Content-Disposition":
          `attachment; filename="${caseNo}_evidence_package.zip"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/evidence-package] error:", err);
    return NextResponse.json({ error: "存证包生成失败，请稍后重试" }, { status: 500 });
  }
}
