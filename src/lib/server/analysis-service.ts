/**
 * 声盾 — 分析结果持久化服务（存证核心）
 * 服务端复核 → 哈希固定 → 证据落盘 → 案例入库
 */
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { analyzeBuffer } from "@/lib/engine/engine";
import { ENGINE_VERSION } from "@/lib/engine/types";
import { encodeWav16 } from "@/lib/audio/wav";
import {
  nextCaseNo,
  saveEvidence,
  sha256Hex,
  isUniqueConstraintError,
} from "./case-service";
import type { AnalysisResult } from "@/lib/engine/types";

export interface PersistOptions {
  sourceType: "LIVE" | "UPLOAD" | "TTS";
  sourceLabel: string;
  fileName?: string;
  fileSize?: number;
  sourceHash?: string;
  notes?: string;
  /** v1.3.9：原始来源字节（上传原件 / TTS 原始产物）。提供时落盘为
   *  {caseNo}_source.bin，使 sourceHash 可被 /api/verify 端到端核验；
   *  同时服务端【重算】哈希，不再信任客户端声明值。 */
  sourceBuffer?: Uint8Array;
}

export interface PersistedCase {
  caseNo: string;
  createdAt: string;
  analysis: AnalysisResult;
  audioHash: string;
  sourceHash?: string;
}

/**
 * 服务端复核并存证（v1.3.9 并发安全重排序）：
 * 1. 用与客户端相同的引擎对 PCM 重新分析（复核客户端初判）
 * 2. 将 PCM 封装为 16kHz WAV，计算 SHA-256 哈希（证据固定）
 * 3. 【先插库】案例连同逐窗判决入库（唯一索引 + 撞号重试独占编号）
 * 4. 【后写盘】案例行插入成功后才写证据/来源文件 —— 编号已被唯一索引
 *    独占，写盘无竞态；写盘失败则补偿删除案例行，杜绝「有记录无证据」
 *    或旧版「后写者覆盖先写者证据」的静默污染。
 */
export async function analyzeAndPersist(
  pcm16k: Float32Array,
  opts: PersistOptions
): Promise<PersistedCase> {
  const analysis = analyzeBuffer(pcm16k);
  const wav = encodeWav16(pcm16k, 16000);
  const audioHash = sha256Hex(wav);

  // v1.3.9：服务端自算来源哈希（有原始字节时不信任客户端声明值）
  const sourceHash = opts.sourceBuffer
    ? sha256Hex(opts.sourceBuffer)
    : opts.sourceHash;

  const baseData = {
    sourceType: opts.sourceType,
    sourceLabel: opts.sourceLabel,
    fileName: opts.fileName ?? null,
    fileSize: opts.fileSize ?? null,
    sourceHash: sourceHash ?? null,
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
    windows: analysis.windows as unknown as Prisma.InputJsonValue,
    featureProfile: analysis.featureProfile as unknown as Prisma.InputJsonValue,
    segments: analysis.segments as unknown as Prisma.InputJsonValue,
    channel: analysis.channel,
    engineVersion: ENGINE_VERSION,
    rtf: analysis.stats.rtf,
    analyzeMs: Math.round(analysis.stats.analyzeMs),
    serverVerified: true,
    notes: opts.notes ?? null,
  };

  // 先插库：撞唯一约束（并发同 tick）则换号重试
  let caseNo = "";
  let inserted = false;
  for (let attempt = 0; attempt < 8 && !inserted; attempt++) {
    caseNo = await nextCaseNo();
    try {
      await db.detectionCase.create({ data: { ...baseData, caseNo } });
      inserted = true;
    } catch (e) {
      if (isUniqueConstraintError(e)) continue; // 并发撞号 → 换号重试
      throw e;
    }
  }
  if (!inserted) {
    throw new Error("案例编号分配失败（并发冲突），请重试");
  }

  // 后写盘：编号已被唯一索引独占，无竞态；失败则补偿删除案例行
  try {
    saveEvidence(caseNo, wav, "evidence");
    if (opts.sourceBuffer && opts.sourceBuffer.length > 0) {
      saveEvidence(caseNo, opts.sourceBuffer, "source");
    }
  } catch (e) {
    await db.detectionCase.delete({ where: { caseNo } }).catch(() => {});
    throw new Error(
      `证据文件写入失败（${e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)}），已回滚案例记录，请重试`
    );
  }

  return {
    caseNo,
    createdAt: new Date().toISOString(),
    analysis,
    audioHash,
    sourceHash: sourceHash ?? undefined,
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
