/**
 * 声盾 — 分析结果持久化服务（存证核心）
 * 服务端复核 → 哈希固定 → 证据落盘 → 案例入库
 */
import { db } from "@/lib/db";
import { analyzeBuffer } from "@/lib/engine/engine";
import { ENGINE_VERSION } from "@/lib/engine/types";
import { encodeWav16 } from "@/lib/audio/wav";
import { nextCaseNo, saveEvidence, sha256Hex } from "./case-service";
import type { AnalysisResult } from "@/lib/engine/types";

export interface PersistOptions {
  sourceType: "LIVE" | "UPLOAD" | "TTS";
  sourceLabel: string;
  fileName?: string;
  fileSize?: number;
  sourceHash?: string;
  notes?: string;
}

export interface PersistedCase {
  caseNo: string;
  createdAt: string;
  analysis: AnalysisResult;
  audioHash: string;
  sourceHash?: string;
}

/**
 * 服务端复核并存证：
 * 1. 用与客户端相同的引擎对 PCM 重新分析（复核客户端初判）
 * 2. 将 PCM 封装为 16kHz WAV，计算 SHA-256 哈希（证据固定）
 * 3. 证据 WAV 落盘，案例连同逐窗判决入库
 */
export async function analyzeAndPersist(
  pcm16k: Float32Array,
  opts: PersistOptions
): Promise<PersistedCase> {
  const analysis = analyzeBuffer(pcm16k);
  const wav = encodeWav16(pcm16k, 16000);
  const audioHash = sha256Hex(wav);
  const caseNo = await nextCaseNo();
  saveEvidence(caseNo, wav, "evidence");

  await db.detectionCase.create({
    data: {
      caseNo,
      sourceType: opts.sourceType,
      sourceLabel: opts.sourceLabel,
      fileName: opts.fileName ?? null,
      fileSize: opts.fileSize ?? null,
      sourceHash: opts.sourceHash ?? null,
      durationSec: analysis.audio.durationSec,
      sampleRate: 16000,
      audioHash,
      overallRisk: analysis.overall.risk,
      syntheticRatio: analysis.overall.syntheticRatio,
      meanScore: analysis.overall.meanScore,
      maxScore: analysis.overall.maxScore,
      windowCount: analysis.audio.voicedWindows,
      voicedWindowCount: analysis.audio.voicedWindows,
      totalWindows: analysis.audio.totalWindows,
      windows: analysis.windows,
      featureProfile: analysis.featureProfile,
      segments: analysis.segments,
      channel: analysis.channel,
      engineVersion: ENGINE_VERSION,
      rtf: analysis.stats.rtf,
      analyzeMs: Math.round(analysis.stats.analyzeMs),
      serverVerified: true,
      notes: opts.notes ?? null,
    },
  });

  return {
    caseNo,
    createdAt: new Date().toISOString(),
    analysis,
    audioHash,
    sourceHash: opts.sourceHash,
  };
}

/** 案例记录 → 前端展示结构 */
export function caseToDTO(c: {
  caseNo: string;
  sourceType: string;
  sourceLabel: string;
  fileName: string | null;
  durationSec: number;
  audioHash: string;
  sourceHash: string | null;
  overallRisk: string;
  syntheticRatio: number;
  meanScore: number;
  maxScore: number;
  totalWindows: number;
  voicedWindowCount: number;
  channel: string;
  engineVersion: string;
  rtf: number;
  createdAt: Date;
  windows: unknown;
  featureProfile: unknown;
  segments: unknown;
}) {
  return {
    caseNo: c.caseNo,
    sourceType: c.sourceType,
    sourceLabel: c.sourceLabel,
    fileName: c.fileName,
    durationSec: c.durationSec,
    audioHash: c.audioHash,
    sourceHash: c.sourceHash,
    overallRisk: c.overallRisk,
    syntheticRatio: c.syntheticRatio,
    meanScore: c.meanScore,
    maxScore: c.maxScore,
    totalWindows: c.totalWindows,
    voicedWindowCount: c.voicedWindowCount,
    channel: c.channel,
    engineVersion: c.engineVersion,
    rtf: c.rtf,
    createdAt: c.createdAt.toISOString(),
    windows: c.windows,
    featureProfile: c.featureProfile,
    segments: c.segments,
  };
}
