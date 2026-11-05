/**
 * 声盾 — 服务端共用：案例编号生成与证据文件管理
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";

const EVIDENCE_DIR = path.join(process.cwd(), "evidence");

export function sha256Hex(data: Uint8Array | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 生成案件编号：SS-YYYYMMDD-XXXX（当日序号） */
export async function nextCaseNo(): Promise<string> {
  const now = new Date();
  const dateStr =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const countToday = await db.detectionCase.count({
    where: { createdAt: { gte: dayStart } },
  });
  let seq = countToday + 1;
  // 极小概率并发冲突时递增重试
  for (let i = 0; i < 50; i++) {
    const caseNo = `SS-${dateStr}-${String(seq).padStart(4, "0")}`;
    const exists = await db.detectionCase.findUnique({ where: { caseNo } });
    if (!exists) return caseNo;
    seq++;
  }
  return `SS-${dateStr}-${Date.now() % 10000}`;
}

export function evidencePath(caseNo: string, kind: "evidence" | "source" = "evidence"): string {
  return path.join(EVIDENCE_DIR, `${caseNo}_${kind}.wav`);
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
