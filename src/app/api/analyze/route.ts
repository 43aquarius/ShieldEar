/**
 * POST /api/analyze — 接收 16kHz 单声道 PCM（Int16 base64），服务端复核分析并存证
 * 场景：实时鉴听结束提交、文件检测上传
 *
 * v1.3.9：
 *   · 可选 sourceB64 —— 上传检测的【原始文件字节】随请求携带，服务端落盘为
 *     {caseNo}_source.bin 并自行重算 sourceHash（不再信任客户端声明值），
 *     使 /api/verify 的「原始来源文件」核验真正可执行（旧版恒 skipped）；
 *   · Content-Length 早期上限（16 MiB）—— 旧版把任意大小的 JSON 全量读入
 *     内存、base64 解码、转 PCM 之后才做时长检查；
 *   · 500 响应经 safeApiMessage 清洗，Prisma 原始栈不再外泄。
 */
import { NextRequest, NextResponse } from "next/server";
import { int16ToFloat } from "@/lib/audio/wav";
import { analyzeAndPersist } from "@/lib/server/analysis-service";
import { safeApiMessage } from "@/lib/server/case-service";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SAMPLES = 16000 * 300; // 最长 300 秒
/** 请求体早期上限：300s PCM(≈12.8MB b64) + ≤12MB 原件的 b64(≈16MB) + 余量 */
const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** 原始来源文件随行上限（超出则只存 PCM 证据，verify 中该单项 skipped） */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    // 早期体积闸：在 JSON 全量读入内存之前拒绝
    const declaredLen = Number(req.headers.get("content-length") || 0);
    if (declaredLen > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: `请求体过大（${(declaredLen / 1048576).toFixed(1)} MiB，上限 16 MiB）：请截取可疑片段或改用较小的源文件` },
        { status: 413 }
      );
    }

    const body = await req.json();
    const {
      pcmB64,
      sourceB64,
      sourceType,
      sourceLabel,
      fileName,
      fileSize,
      sourceHash,
      notes,
    } = body as {
      pcmB64?: string;
      sourceB64?: string;
      sourceType?: string;
      sourceLabel?: string;
      fileName?: string;
      fileSize?: number;
      sourceHash?: string;
      notes?: string;
    };

    if (!pcmB64 || typeof pcmB64 !== "string") {
      return NextResponse.json({ error: "缺少 PCM 数据" }, { status: 400 });
    }
    if (sourceType !== "LIVE" && sourceType !== "UPLOAD") {
      return NextResponse.json({ error: "无效的 sourceType" }, { status: 400 });
    }

    const buf = Buffer.from(pcmB64, "base64");
    const pcm = int16ToFloat(new Uint8Array(buf));
    if (pcm.length < 16000 * 2) {
      return NextResponse.json(
        { error: "音频过短（至少需要 2 秒有效语音）" },
        { status: 400 }
      );
    }
    if (pcm.length > MAX_SAMPLES) {
      return NextResponse.json(
        { error: "音频超出长度上限（300 秒），请截取可疑片段后重试" },
        { status: 400 }
      );
    }

    // v1.3.9：原始来源字节（可选；超限静默降级为仅 PCM 证据）
    let sourceBuffer: Uint8Array | undefined;
    if (typeof sourceB64 === "string" && sourceB64.length > 0) {
      const srcLen = Math.floor((sourceB64.length * 3) / 4);
      if (srcLen > MAX_SOURCE_BYTES) {
        return NextResponse.json(
          { error: `原始文件过大（${(srcLen / 1048576).toFixed(1)} MiB，上限 12 MiB）：本次仅存证据音频，请压缩后重试或改用「文件检测」直接分析` },
          { status: 413 }
        );
      }
      sourceBuffer = new Uint8Array(Buffer.from(sourceB64, "base64"));
    }

    const result = await analyzeAndPersist(pcm, {
      sourceType,
      sourceLabel: sourceLabel || "未命名样本",
      fileName,
      fileSize,
      sourceHash,
      notes,
      sourceBuffer,
    });

    return NextResponse.json({
      caseNo: result.caseNo,
      createdAt: result.createdAt,
      audioHash: result.audioHash,
      sourceHash: result.sourceHash ?? null,
      sourcePreserved: !!sourceBuffer,
      analysis: result.analysis,
    });
  } catch (err) {
    console.error("[api/analyze] error:", err);
    return NextResponse.json(
      { error: safeApiMessage(err, "分析失败，请稍后重试") },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    engine: "ShieldEar",
    endpoint: "POST pcmB64(int16/base64, 16kHz mono) [+ sourceB64 原始文件] → 案例存证",
  });
}
