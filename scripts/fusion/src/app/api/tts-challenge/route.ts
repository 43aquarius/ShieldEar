/**
 * POST /api/tts-challenge — 现场合成挑战
 * 服务端用 TTS 现场合成语音 → 声盾引擎现场检测 → 存证入库 → 返回音频与判决
 * 演示叙事：评委亲眼见证"AI 语音被生成"，随后被声盾实时识破。
 *
 * 四级合成链（2026-10-28 重构，v1.3.3 融合）——保证「现场合成用户输入文本」永远可用：
 *   Tier 1 · z-ai 网关 TTS（仅云端通道开启时尝试；WAF 路径惩罚期间熔断 5 分钟自动探活恢复）
 *   Tier 2 · Edge 神经 TTS（微软公共神经语音；仅云端通道开启时尝试）
 *   Tier 3 · espeak-ng 本地合成（完全离线；离线包默认主通道：零联网零尝试零等待）
 *   Tier 4 · 预置样本回放（仅在以上全部不可用时，如实标注 fallback）
 * 每次使用的引擎在响应 mode/engine/engineLabel 与存证 notes 三处如实记录。
 *
 * 云端通道（v1.3.3 统一到 src/lib/server/cloud-config.ts）：
 *   环境默认：SHIELD_TTS_ONLINE=1 → 开启四级链；未设置 → 纯离线（便携包默认）；
 *   运行时：GET/POST /api/config/cloud 界面即时切换，无需重启，重启回落环境默认。
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { synthesizeSpeech } from "@/lib/server/tts-client";
import { synthesizeEdge, synthesizeEspeak } from "@/lib/server/local-tts";
import { isCloudEnabled, cloudChannelSummary } from "@/lib/server/cloud-config";
import { decodeWav, mixToMono, encodeWav16, floatToInt16 } from "@/lib/audio/wav";
import { resampleTo16k } from "@/lib/engine/dsp";
import { analyzeAndPersist } from "@/lib/server/analysis-service";
import { sha256Hex } from "@/lib/server/case-service";

export const runtime = "nodejs";
export const maxDuration = 120;

const VOICES = ["tongtong", "chuichui", "xiaochen", "jam", "kazi", "douji", "luodo"] as const;

/** z-ai 网关熔断器：WAF 拦截后 5 分钟内跳过 Tier 1，避免每次演示都撞墙 */
let zaiCircuitOpenUntil = 0;
const ZAI_CIRCUIT_MS = 5 * 60 * 1000;

/** 四级链统一产出（在 SynthResult 之上补 zai / preset 两档） */
interface TierSynth {
  wavBuffer: Buffer;
  originalBuffer: Buffer;
  originalMime: string;
  originalExt: string;
  engine: "zai" | "edge" | "espeak" | "preset";
  engineLabel: string;
}

export async function GET() {
  return NextResponse.json({
    online: isCloudEnabled(),
    chain: isCloudEnabled()
      ? ["云端 TTS · z-ai 网关", "Edge 神经 TTS", "本地 espeak-ng", "预置样本回放"]
      : ["本地 espeak-ng（默认）", "预置样本回放"],
    hint: cloudChannelSummary(),
  });
}

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
    // 去除控制字符（子进程安全 + 展示安全）
    const cleanText = text.trim().replace(/[\u0000-\u001f\u007f]/g, "");
    if (cleanText.length > 1024) {
      return NextResponse.json({ error: "文本过长（上限 1024 字符）" }, { status: 400 });
    }
    if (!VOICES.includes(voice as (typeof VOICES)[number])) {
      return NextResponse.json({ error: `音色不支持，可用：${VOICES.join(" / ")}` }, { status: 400 });
    }
    const spd = Math.min(2, Math.max(0.5, speed));

    const tierErrors: string[] = [];
    let synth: TierSynth | null = null;
    let mode: "live" | "fallback" = "live";
    const cloudOn = isCloudEnabled();

    // ── Tier 1 · z-ai 网关（云端通道开启时才尝试；熔断保护，快速失败：单次 15s 超时） ──
    if (cloudOn && Date.now() >= zaiCircuitOpenUntil) {
      try {
        const buf = await synthesizeSpeech(
          { input: cleanText, voice, speed: spd, response_format: "wav" },
          15_000,
          1
        );
        synth = {
          wavBuffer: buf,
          originalBuffer: buf,
          originalMime: "audio/wav",
          originalExt: "wav",
          engine: "zai",
          engineLabel: "云端 TTS · z-ai 网关",
        };
      } catch (e) {
        zaiCircuitOpenUntil = Date.now() + ZAI_CIRCUIT_MS;
        tierErrors.push(`zai网关: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
        console.error("[api/tts-challenge] Tier1(z-ai) 失败，熔断 5 分钟");
      }
    } else if (!cloudOn) {
      tierErrors.push("zai网关: 云端通道已关闭（离线模式，未发任何网络请求）");
    }

    // ── Tier 2 · Edge 神经 TTS（微软公共神经语音；仅云端通道开启时尝试） ──
    if (!synth && cloudOn) {
      try {
        const r = await synthesizeEdge(cleanText, voice, spd);
        synth = { ...r };
      } catch (e) {
        tierErrors.push(`Edge: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
        console.error("[api/tts-challenge] Tier2(edge) 失败:", e);
      }
    } else if (!synth && !cloudOn) {
      tierErrors.push("Edge: 云端通道已关闭（离线模式，未发任何网络请求）");
    }

    // ── Tier 3 · espeak-ng 本地合成（完全离线；离线包默认主通道） ──
    if (!synth) {
      try {
        const r = await synthesizeEspeak(cleanText, voice, spd);
        synth = { ...r };
      } catch (e) {
        tierErrors.push(`espeak: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
        console.error("[api/tts-challenge] Tier3(espeak) 失败:", e);
      }
    }

    // ── Tier 4 · 预置样本回放（同引擎预生成，如实标注 fallback） ──
    if (!synth) {
      try {
        const preset = await readFile(
          path.join(process.cwd(), "public", "samples", "challenge", `tts_${voice}.wav`)
        );
        synth = {
          wavBuffer: preset,
          originalBuffer: preset,
          originalMime: "audio/wav",
          originalExt: "wav",
          engine: "preset",
          engineLabel: "预置样本回放",
        };
        mode = "fallback";
      } catch {
        return NextResponse.json(
          {
            error:
              "语音合成通道暂时不可用（已自动尝试 4 级通道），请稍候片刻再试；亦可改用「文件检测」中的预置合成样本",
          },
          { status: 503 }
        );
      }
    }

    if (!synth.wavBuffer || synth.wavBuffer.length < 2000) {
      return NextResponse.json({ error: "合成结果异常，请重试" }, { status: 502 });
    }

    // 解码 → 16kHz 单声道（Edge 已是 16k；espeak 22.05k / z-ai 24k 统一重采样）
    const decoded = decodeWav(synth.wavBuffer);
    const mono = mixToMono(decoded.pcm, decoded.channels);
    const pcm16k = resampleTo16k(mono, decoded.sampleRate);

    // 原始合成产物哈希（证据：本音频确实由平台现场生成）
    const sourceHash = sha256Hex(synth.originalBuffer);

    const isFallback = mode === "fallback";
    const sourceLabel = isFallback
      ? `合成挑战(预置样本回放) · ${voice}`
      : `现场合成挑战 · ${voice}（${synth.engineLabel}）`;

    // 服务端分析并存证（sourceType=TTS）
    const result = await analyzeAndPersist(pcm16k, {
      sourceType: "TTS",
      sourceLabel,
      fileName: isFallback ? `tts_${voice}.wav` : `tts_${voice}.${synth.originalExt}`,
      fileSize: synth.originalBuffer.length,
      sourceHash,
      notes: isFallback
        ? `本地合成通道亦不可用，回放预置合成样本；通道错误摘要：${tierErrors.join(" | ").slice(0, 300)}`
        : `该音频由「${synth.engineLabel}」现场合成用户输入文本，用于鉴伪能力演示` +
          (cloudOn
            ? tierErrors.length
              ? `；通道降级记录：${tierErrors.join(" | ").slice(0, 200)}`
              : ""
            : "；当前为完全离线模式（云端通道关闭，未发任何网络请求）"),
    });

    // 证据 WAV（16kHz）与原始产物的 base64（前端播放 + 可下载）
    const evidenceWav = encodeWav16(pcm16k, 16000);
    const evidenceB64 = Buffer.from(evidenceWav).toString("base64");
    const originalB64 = synth.originalBuffer.toString("base64");

    // 引擎复核用的 Int16 PCM（前端逐窗回放对齐）
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
      mode,
      engine: synth.engine,
      engineLabel: synth.engineLabel,
      sourceLabel,
      online: cloudOn,
      cloudEnabled: cloudOn,
      tts: {
        voice,
        text: isFallback ? "(预置合成样本，非当前文本现场合成)" : cleanText,
        sampleRate: decoded.sampleRate,
      },
      audio: {
        evidenceB64,
        originalB64,
        originalMime: synth.originalMime,
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
