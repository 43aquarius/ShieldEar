/**
 * probe-e2e-latency.ts — 端到端判决时延剖析（v1.3.15 审查池·性能）
 *
 * 口径：与前端 file-panel 完全一致的请求形态（pcmB64+sourceB64 双证据路径），
 * 对 dev server 实测 POST /api/analyze 全链路 RTT，并用响应内引擎自报
 * analysis.stats.analyzeMs 做无损分解：overheadMs = totalMs − analyzeMs
 * （overhead = base64 解码 + WAV 封装 + SHA-256 + Prisma 入库 + 证据落盘 + JSON 序列化）。
 *
 * 对照组：GET /api（HTTP 框架底噪）、GET /api/cases?limit=100（DB 读+大 JSON 序列化）。
 * 全部产生的案例在结束时 DELETE 清理，不污染案例库。
 *
 * 用法：bun scripts/probe-e2e-latency.ts [baseUrl]  （默认 http://localhost:3000）
 * 留档：calibration/e2e_latency_results.json
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const ROUNDS = 5;
const BUDGET_FILES = 12;

function decodeWav(path: string): { pcm: Float32Array; durationSec: number } {
  const buf = readFileSync(path);
  // RIFF 解析：找 fmt 与 data 块
  let off = 12;
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = {
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22),
      };
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = size;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || dataOff < 0 || fmt.bits !== 16) throw new Error(`不支持 wav: ${path}`);
  const frames = Math.floor(dataLen / 2 / fmt.channels);
  const pcm = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < fmt.channels; c++) acc += buf.readInt16LE(dataOff + (i * fmt.channels + c) * 2);
    pcm[i] = acc / fmt.channels / 32768;
  }
  return { pcm, durationSec: frames / fmt.sampleRate };
}

function pcmToB64(pcm: Float32Array): string {
  const i16 = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    i16[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return Buffer.from(i16.buffer).toString("base64");
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function timedFetch(url: string, init?: RequestInit): Promise<{ ms: number; status: number; body: string }> {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const body = await res.text();
  return { ms: performance.now() - t0, status: res.status, body };
}

interface Row {
  file: string;
  durationSec: number;
  payloadKB: number;
  totalMs: number;
  analyzeMs: number;
  overheadMs: number;
  caseNo: string;
}

async function main() {
  const dir = join(process.cwd(), "calibration", "audio");
  const files = readdirSync(dir).filter((f) => f.endsWith(".wav")).sort();

  // 时长分档取代表：按解码时长排序后等间隔抽 12 条
  const decoded = files.map((f) => ({ f, ...decodeWav(join(dir, f)) }));
  decoded.sort((a, b) => a.durationSec - b.durationSec);
  const step = Math.max(1, Math.floor(decoded.length / BUDGET_FILES));
  const picked = decoded.filter((_, i) => i % step === 0).slice(0, BUDGET_FILES);
  console.log(`抽样 ${picked.length}/${decoded.length} 条，时长 ${picked[0].durationSec.toFixed(1)}s ~ ${picked[picked.length-1].durationSec.toFixed(1)}s，每条 ${ROUNDS} 轮`);

  // 预热：1 次 GET + 1 次 analyze（JIT/DB 连接池）
  await timedFetch(`${BASE}/api`);
  const warm = picked[0];
  const warmBody = JSON.stringify({ pcmB64: pcmToB64(warm.pcm), sourceB64: pcmToB64(warm.pcm).slice(0, 1024), sourceType: "UPLOAD", sourceLabel: "e2e-warmup", fileName: warm.f });
  const warmRes = await timedFetch(`${BASE}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: warmBody });
  if (warmRes.status !== 200) throw new Error(`预热失败 ${warmRes.status}: ${warmRes.body.slice(0, 200)}`);

  const rows: Row[] = [];
  const createdCases: string[] = [JSON.parse(warmRes.body).caseNo];

  for (const s of picked) {
    const pcmB64 = pcmToB64(s.pcm);
    const srcB64 = readFileSync(join(dir, s.f)).toString("base64");
    const body = JSON.stringify({ pcmB64, sourceB64: srcB64, sourceType: "UPLOAD", sourceLabel: "e2e-probe", fileName: s.f });
    for (let r = 0; r < ROUNDS; r++) {
      const res = await timedFetch(`${BASE}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (res.status !== 200) throw new Error(`${s.f} 第${r + 1}轮失败 ${res.status}: ${res.body.slice(0, 200)}`);
      const j = JSON.parse(res.body);
      const analyzeMs = Number(j.analysis?.stats?.analyzeMs ?? NaN);
      createdCases.push(j.caseNo);
      rows.push({ file: s.f, durationSec: Number(s.durationSec.toFixed(2)), payloadKB: Number((body.length / 1024).toFixed(1)), totalMs: Number(res.ms.toFixed(1)), analyzeMs, overheadMs: Number((res.ms - analyzeMs).toFixed(1)), caseNo: j.caseNo });
    }
    console.log(`✓ ${s.f} (${s.durationSec.toFixed(1)}s)`);
  }

  // 对照组
  const noise: number[] = [];
  for (let i = 0; i < 20; i++) noise.push((await timedFetch(`${BASE}/api`)).ms);
  const casesRead: number[] = [];
  for (let i = 0; i < 10; i++) casesRead.push((await timedFetch(`${BASE}/api/cases?limit=100`)).ms);

  // 统计
  const byDur = new Map<number, Row[]>();
  for (const r of rows) {
    const k = Math.round(r.durationSec);
    if (!byDur.has(k)) byDur.set(k, []);
    byDur.get(k)!.push(r);
  }
  const summary = [...byDur.entries()].sort((a, b) => a[0] - b[0]).map(([dur, rs]) => {
    const t = rs.map((r) => r.totalMs).sort((a, b) => a - b);
    const a = rs.map((r) => r.analyzeMs).sort((x, y) => x - y);
    const o = rs.map((r) => r.overheadMs).sort((x, y) => x - y);
    return { durationSec: dur, n: rs.length, payloadKB: rs[0].payloadKB, totalP50: pct(t, 50), totalP95: pct(t, 95), analyzeP50: pct(a, 50), analyzeP95: pct(a, 95), overheadP50: pct(o, 50), overheadP95: pct(o, 95), overheadSharePct: Number(((pct(o, 50) / pct(t, 50)) * 100).toFixed(1)) };
  });
  const allT = rows.map((r) => r.totalMs).sort((a, b) => a - b);
  const allA = rows.map((r) => r.analyzeMs).sort((a, b) => a - b);
  const allO = rows.map((r) => r.overheadMs).sort((a, b) => a - b);
  const overall = { n: rows.length, totalP50: pct(allT, 50), totalP95: pct(allT, 95), totalP99: pct(allT, 99), analyzeP50: pct(allA, 50), analyzeP95: pct(allA, 95), overheadP50: pct(allO, 50), overheadP95: pct(allO, 95), overheadSharePct: Number(((pct(allO, 50) / pct(allT, 50)) * 100).toFixed(1)) };

  console.log("\n═══ 端到端分档 ═══");
  for (const s of summary) console.log(`${String(s.durationSec).padStart(3)}s n=${s.n} payload=${s.payloadKB}KB | total P50 ${s.totalP50}ms P95 ${s.totalP95}ms | 引擎 P50 ${s.analyzeP50}ms | overhead P50 ${s.overheadP50}ms (${s.overheadSharePct}%)`);
  console.log("═══ 总体 ═══", JSON.stringify(overall));
  console.log(`GET /api 底噪 P50 ${pct(noise.sort((a, b) => a - b), 50).toFixed(1)}ms | GET /api/cases?limit=100 P50 ${pct(casesRead.sort((a, b) => a - b), 50).toFixed(1)}ms P95 ${pct(casesRead, 95).toFixed(1)}ms`);

  writeFileSync(join(process.cwd(), "calibration", "e2e_latency_results.json"), JSON.stringify({ engine: "ShieldEar", measuredAt: new Date().toISOString(), env: { base: BASE, roundsPerFile: ROUNDS, filesPicked: picked.length, source: "calibration/audio 49 条按时长等间隔抽样 12" }, method: "POST /api/analyze 客户端 RTT − 响应内 analysis.stats.analyzeMs 无损分解；对照 GET /api 与 GET /api/cases", overall, byDuration: summary, controls: { getApiP50: Number(pct(noise, 50).toFixed(1)), getCasesP50: Number(pct(casesRead, 50).toFixed(1)), getCasesP95: Number(pct(casesRead, 95).toFixed(1)) }, raw: rows }, null, 2));
  console.log(`\n留档 calibration/e2e_latency_results.json · 本次产生 ${createdCases.length} 个案例，开始清理…`);

  let cleaned = 0;
  for (const caseNo of createdCases) {
    const r = await fetch(`${BASE}/api/cases/${caseNo}`, { method: "DELETE" });
    if (r.ok) cleaned++;
  }
  console.log(`清理完成 ${cleaned}/${createdCases.length}`);
}

main().catch((e) => { console.error("探针失败:", e); process.exit(1); });
