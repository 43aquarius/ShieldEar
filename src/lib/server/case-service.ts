/**
 * 声盾 — 服务端共用：案例编号生成与证据文件管理
 * v1.3.9：修复并发存证竞态 —— 旧实现「count+1 先查后插 + 先写文件后插库」，
 * 两个并发请求会拿到同一编号并先后写同一证据文件，后写者覆盖先写者；
 * 插库时一个撞唯一约束报 500（且泄漏 Prisma 原始栈），但存活案例的
 * 证据音频已是另一个案子的内容（真机审计 6/6 复现）。
 * 新实现：当日最大序号 + 进程内单调计数 + 唯一约束撞号重试 + 先插库后写文件
 * （案例行插入成功即独占编号，之后再写文件无竞态；写文件失败则补偿删除）。
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { resolveInsideDir } from "@/lib/server/case-no";

const EVIDENCE_DIR = path.join(process.cwd(), "evidence");

export function sha256Hex(data: Uint8Array | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 进程内当日已发最大序号（单进程便携包内足以消除并发撞号） */
const inProcessSeq = new Map<string, number>();

/**
 * 生成案件编号：SS-YYYYMMDD-XXXX（当日序号）
 * v1.3.9：改为「当日库内最大序号 + 1」，并用进程内单调计数兼防同 tick 并发；
 * 同时解决旧 count+1 方案「删除末尾案例后编号被重用」的问题（max+1 只在
 * 删除当日最大案例且重启进程后才可能重用，已属可接受边界）。
 * 注意：编号只表示「意向」，真正占用由唯一索引 + createCaseAtomic 的重试保证。
 */
export async function nextCaseNo(): Promise<string> {
  const now = new Date();
  const dateStr =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const prefix = `SS-${dateStr}-`;
  // 当日库内最大编号（同前缀下字典序最大 = 数值最大，4 位零填充）
  const last = await db.detectionCase.findFirst({
    where: { caseNo: { startsWith: prefix } },
    orderBy: { caseNo: "desc" },
    select: { caseNo: true },
  });
  const dbSeq = last ? Number(last.caseNo.slice(prefix.length)) || 0 : 0;
  const seq = Math.max(dbSeq, inProcessSeq.get(dateStr) ?? 0) + 1;
  inProcessSeq.set(dateStr, seq);
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/** Prisma 唯一约束冲突（P2002）判定 —— 用于撞号重试 */
export function isUniqueConstraintError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "P2002" || /Unique constraint failed/i.test(String(err?.message ?? ""));
}

/**
 * API 错误清洗（v1.3.9）：Prisma / 内部堆栈不外泄给前端。
 * 旧实现 500 响应体直接携带 `Invalid prisma.detectionCase.create() invocation…`
 * 原文（含字段名与栈片段），既不友好也暴露内部结构。
 */
export function safeApiMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /prisma|Invalid `|invocation|Unique constraint|WHERE parameters|stack|\n\s*at /i.test(msg)
  ) {
    return fallback;
  }
  return msg.slice(0, 300);
}

export function evidencePath(caseNo: string, kind: "evidence" | "source" = "evidence"): string {
  // v1.3.9：原始来源文件（可能是 mp3/m4a/webm 等任意格式）落盘为 .bin，
  // 由 /api/evidence 按案例记录的原始文件名下发；证据音频恒为 16kHz WAV。
  // v1.3.14：容器闸 —— 解析结果必须仍在 evidence/ 内，物理阻断路径遍历
  // （格式闸见各路由的 isValidCaseNo 早退，两道防线独立生效）。
  const ext = kind === "evidence" ? "wav" : "bin";
  return resolveInsideDir(EVIDENCE_DIR, `${caseNo}_${kind}.${ext}`);
}

export function saveEvidence(caseNo: string, wav: Uint8Array, kind: "evidence" | "source" = "evidence"): void {
  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(evidencePath(caseNo, kind), wav);
}

export function readEvidence(caseNo: string, kind: "evidence" | "source" = "evidence"): Buffer | null {
  const p = evidencePath(caseNo, kind);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p);
}

/* ══════════════════════ 证据完整性核验（v1.3.5） ══════════════════════ */

export interface IntegrityCheck {
  name: string;
  /** ok=通过；skipped=该项不适用（如无原始文件） */
  status: "ok" | "fail" | "skipped";
  detail: string;
}

export interface IntegrityReport {
  caseNo: string;
  verified: boolean;
  checks: IntegrityCheck[];
  storedAudioHash: string;
  recomputedAudioHash: string | null;
  storedSourceHash: string | null;
  recomputedSourceHash: string | null;
  evidenceBytes: number | null;
  checkedAt: string;
  durationMs: number;
}

/**
 * 证据完整性核验：重新读取证据 WAV → 重算 SHA-256 → 与入库时的哈希比对。
 * 任何一项不一致即 verified=false（证据可能被篡改或损坏）。
 * 这是"存证 → 验真"闭环的验真端：证明证据自入库以来未被改动。
 */
export async function verifyEvidenceIntegrity(caseNo: string): Promise<IntegrityReport> {
  const t0 = Date.now();
  const checks: IntegrityCheck[] = [];
  const rec = await db.detectionCase.findUnique({
    where: { caseNo },
    select: { audioHash: true, sourceHash: true },
  });

  if (!rec) {
    checks.push({ name: "案例记录", status: "fail", detail: `案例库中不存在 ${caseNo}` });
    return {
      caseNo,
      verified: false,
      checks,
      storedAudioHash: "",
      recomputedAudioHash: null,
      storedSourceHash: null,
      recomputedSourceHash: null,
      evidenceBytes: null,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    };
  }
  checks.push({ name: "案例记录", status: "ok", detail: "案例已入库，哈希字段齐全" });

  // ── 证据音频（16kHz WAV）核验 ──
  const ev = readEvidence(caseNo, "evidence");
  let recomputed: string | null = null;
  if (!ev) {
    checks.push({
      name: "证据音频",
      status: "fail",
      detail: `证据文件缺失：evidence/${caseNo}_evidence.wav 不存在（可能被删除或包不完整）`,
    });
  } else {
    recomputed = sha256Hex(ev);
    if (recomputed === rec.audioHash) {
      checks.push({
        name: "证据音频哈希",
        status: "ok",
        detail: `重算 SHA-256 与入库值一致（${ev.length.toLocaleString()} 字节）`,
      });
    } else {
      checks.push({
        name: "证据音频哈希",
        status: "fail",
        detail: `SHA-256 不一致：证据文件自入库后被改动或损坏（入库 ${rec.audioHash.slice(0, 16)}… / 重算 ${recomputed.slice(0, 16)}…）`,
      });
    }
  }

  // ── 原始来源文件核验（UPLOAD/TTS 存在 source 证据时才核验） ──
  const src = readEvidence(caseNo, "source");
  if (rec.sourceHash) {
    if (!src) {
      checks.push({
        name: "原始来源文件",
        status: "skipped",
        detail: "库中记录了来源哈希，但原始文件未随包保留（不影响证据音频的完整性结论）",
      });
    } else {
      const srcHash = sha256Hex(src);
      if (srcHash === rec.sourceHash) {
        checks.push({ name: "原始来源哈希", status: "ok", detail: "原始文件重算 SHA-256 与入库值一致" });
      } else {
        checks.push({
          name: "原始来源哈希",
          status: "fail",
          detail: "原始文件哈希不一致：来源文件自入库后被改动",
        });
      }
    }
  } else {
    checks.push({
      name: "原始来源文件",
      status: "skipped",
      detail: "该案例未登记来源哈希（实时鉴听无原始文件；上传文件仅核验证据副本），跳过来源核验",
    });
  }

  const verified = checks.every((c) => c.status !== "fail");
  return {
    caseNo,
    verified,
    checks,
    storedAudioHash: rec.audioHash,
    recomputedAudioHash: recomputed,
    storedSourceHash: rec.sourceHash,
    recomputedSourceHash: src && rec.sourceHash ? sha256Hex(src) : null,
    evidenceBytes: ev ? ev.length : null,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
  };
}
