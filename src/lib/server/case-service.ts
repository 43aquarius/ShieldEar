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
