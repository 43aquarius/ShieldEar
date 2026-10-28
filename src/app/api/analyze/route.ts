/**
 * POST /api/analyze — 接收 16kHz 单声道 PCM（Int16 base64），服务端复核分析并存证
 * 场景：实时鉴听结束提交、文件检测上传
 */
import { NextRequest, NextResponse } from "next/server";
import { int16ToFloat } from "@/lib/audio/wav";
import { analyzeAndPersist } from "@/lib/server/analysis-service";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SAMPLES = 16000 * 300; // 最长 300 秒

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      pcmB64,
      sourceType,
      sourceLabel,
      fileName,
      fileSize,
      sourceHash,
      notes,
    } = body as {
      pcmB64?: string;
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

    const result = await analyzeAndPersist(pcm, {
      sourceType,
      sourceLabel: sourceLabel || "未命名样本",
      fileName,
      fileSize,
      sourceHash,
      notes,
    });

    return NextResponse.json({
      caseNo: result.caseNo,
      createdAt: result.createdAt,
      audioHash: result.audioHash,
      sourceHash: result.sourceHash ?? null,
      analysis: result.analysis,
    });
  } catch (err) {
    console.error("[api/analyze] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "分析失败，请稍后重试" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    engine: "ShieldEar",
    endpoint: "POST pcmB64(int16/base64, 16kHz mono) → 案例存证",
  });
}
