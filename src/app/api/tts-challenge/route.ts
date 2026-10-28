/**
 * POST /api/tts-challenge — 现场合成挑战
 * 服务端用 TTS 现场合成语音 → 声盾引擎现场检测 → 存证入库 → 返回音频与判决
 * 演示叙事：评委亲眼见证"AI 语音被生成"，随后被声盾实时识破。
 */
import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { decodeWav, mixToMono, encodeWav16, floatToInt16 } from "@/lib/audio/wav";
import { resampleTo16k } from "@/lib/engine/dsp";
import { analyzeAndPersist } from "@/lib/server/analysis-service";
import { sha256Hex } from "@/lib/server/case-service";

export const runtime = "nodejs";
export const maxDuration = 120;

const VOICES = ["tongtong", "chuichui", "xiaochen", "jam", "kazi", "douji", "luodo"] as const;

export async function POST(req: NextRequest) {
  try {
    const { text, voice = "tongtong", speed = 1.0 } = (await req.json()) as {
      text?: string;
      voice?: string;
      speed?: number;
    };

    if (!text || !text.trim()) {
      return NextResponse.json({ error: "请输入要合成的文本" }, { status: 400 });
    }
    if (text.length > 1024) {
      return NextResponse.json({ error: "文本过长（上限 1024 字符）" }, { status: 400 });
    }
    if (!VOICES.includes(voice as (typeof VOICES)[number])) {
      return NextResponse.json({ error: `音色不支持，可用：${VOICES.join(" / ")}` }, { status: 400 });
    }

    // 1. 现场合成（服务端调用 TTS，输出 24kHz WAV）
    const zai = await ZAI.create();
    let ttsBuffer: Buffer;
    try {
      const resp = await zai.audio.tts.create({
        input: text.trim(),
        voice,
        speed: Math.min(2, Math.max(0.5, speed)),
        response_format: "wav",
        stream: false,
      });
      const ab = await resp.arrayBuffer();
      ttsBuffer = Buffer.from(new Uint8Array(ab));
    } catch (e) {
      console.error("[api/tts-challenge] TTS error:", e);
      return NextResponse.json(
        { error: "语音合成服务暂时不可用（可能触发限流），请稍候 20 秒再试" },
        { status: 503 }
      );
    }
    if (!ttsBuffer || ttsBuffer.length < 2000) {
      return NextResponse.json({ error: "合成结果异常，请重试" }, { status: 502 });
    }

    // 2. 解码 → 16kHz 单声道
    const decoded = decodeWav(ttsBuffer);
    const mono = mixToMono(decoded.pcm, decoded.channels);
    const pcm16k = resampleTo16k(mono, decoded.sampleRate);

    // 3. 原始合成音频哈希（证据：本音频确实由平台现场生成）
    const sourceHash = sha256Hex(ttsBuffer);

    // 4. 服务端分析并存证（sourceType=TTS）
    const result = await analyzeAndPersist(pcm16k, {
      sourceType: "TTS",
      sourceLabel: `现场合成挑战 · ${voice}`,
      fileName: `tts_${voice}.wav`,
      fileSize: ttsBuffer.length,
      sourceHash,
      notes: "该音频由平台 TTS 引擎现场合成，用于鉴伪能力演示",
    });

    // 5. 证据 WAV（16kHz）的 Int16 视图 → base64（前端播放 + 可下载）
    const evidenceWav = encodeWav16(pcm16k, 16000);
    const evidenceB64 = Buffer.from(evidenceWav).toString("base64");
    const originalB64 = ttsBuffer.toString("base64");

    // 附带引擎复核用的 Int16 PCM（供前端做逐窗回放对齐）
    const pcmI16 = floatToInt16(pcm16k);
    const pcmB64 = Buffer.from(
      pcmI16.buffer,
      pcmI16.byteOffset,
      pcmI16.byteLength
    ).toString("base64");

    return NextResponse.json({
      caseNo: result.caseNo,
      createdAt: result.createdAt,
      audioHash: result.audioHash,
      sourceHash,
      analysis: result.analysis,
      tts: { voice, text: text.trim(), sampleRate: decoded.sampleRate },
      audio: {
        evidenceB64,
        originalB64,
        pcmB64,
        durationSec: pcm16k.length / 16000,
      },
    });
  } catch (err) {
    console.error("[api/tts-challenge] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "合成挑战失败，请重试" },
      { status: 500 }
    );
  }
}
