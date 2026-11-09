/**
 * 声盾引擎单窗时延 P99 复测探针（v1.3.15 · 性能回归基线）
 *
 * 目的：引擎 v2.1.0-robust 新增输入质量护栏（assessQuality）与窗口级/帧级直流去均值，
 *   复测单窗分析时延分布与整段 RTF，验证相对 v1.3.12 文档口径无劣化。
 *
 * 文档基线（docs/声盾-系统测试报告.docx §6.1，引擎 v2.0.0-calibrated，160 有能量窗）：
 *   单窗：均值 7.22ms · 中位 7.45ms · P95 9.12ms · P99 9.65ms · max 10.12ms
 *   RTF：中位 0.0068 · P95 0.0086 · max 0.0123（2 核 CPU 无 GPU）
 *
 * 方法（与文档口径一致）：
 *   1. 全量校准音频 decode → mono → 16kHz；
 *   2. 单窗：全量窗口预热 2 轮（JIT），第 3 轮起逐窗 performance.now() 计时，
 *      仅统计有能量窗（窗 RMS ≥ 0.005，与引擎静音闸同口径）；
 *   3. RTF：每条样本 analyzeBuffer 预热 1 次后正式计时 1 次，RTF = 耗时/音频时长。
 *
 * 用法：bun scripts/probe-latency-p99.ts
 * 输出：calibration/latency_results.json + stdout 对照表
 */
import fs from "fs";
import path from "path";
import { decodeWav, mixToMono } from "../src/lib/audio/wav";
import { resampleTo16k } from "../src/lib/engine/dsp";
import { analyzeBuffer, analyzeWindow } from "../src/lib/engine/engine";
import { ENGINE_VERSION } from "../src/lib/engine/types";

const ADIR = path.join(process.cwd(), "calibration", "audio");
const SR = 16000;
const WIN = 2 * SR;
const HOP = 1 * SR;
const ENERGY_GATE = 0.005; // 与引擎静音闸同口径：RMS ≥ 0.005 视为有能量

const BASELINE_V201 = {
  engine: "v2.0.0-calibrated",
  source: "docs/声盾-系统测试报告.docx §6.1（160 有能量窗，JIT 预热后，2 核 CPU）",
  windowMs: { mean: 7.22, p50: 7.45, p95: 9.12, p99: 9.65, max: 10.12 },
  rtf: { p50: 0.0068, p95: 0.0086, max: 0.0123 },
};

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

const files = fs
  .readdirSync(ADIR)
  .filter((f) => f.endsWith(".wav"))
  .sort();
console.log(`样本：${files.length} 条（calibration/audio）`);

type SampleRec = { file: string; durSec: number; windows: number; rtf: number };
const samples: SampleRec[] = [];
const allWinMs: number[] = [];

for (const f of files) {
  const buf = fs.readFileSync(path.join(ADIR, f));
  const dec = decodeWav(new Uint8Array(buf).buffer);
  const mono = mixToMono(dec.pcm, dec.channels);
  const pcm = dec.sampleRate === SR ? mono : resampleTo16k(mono, dec.sampleRate);
  if (pcm.length < WIN) continue;

  // 收集有能量窗的起点
  const starts: number[] = [];
  for (let s = 0; s + WIN <= pcm.length; s += HOP) {
    let sq = 0;
    for (let i = s; i < s + WIN; i += 4) sq += pcm[i] * pcm[i]; // 1/4 抽样估 RMS（预筛不计入计时）
    const n = Math.ceil((WIN - s % 4) / 4);
    if (Math.sqrt(sq / n) >= ENERGY_GATE) starts.push(s);
  }
  if (!starts.length) continue;

  // JIT 预热 2 轮（全量窗）
  for (let r = 0; r < 2; r++) for (const s of starts) analyzeWindow(pcm, s, 0);

  // 正式计时：逐窗
  for (const s of starts) {
    const t0 = performance.now();
    analyzeWindow(pcm, s, 0);
    allWinMs.push(performance.now() - t0);
  }

  // RTF：整段分析（预热 1 次后正式计时）
  analyzeBuffer(pcm);
  const t1 = performance.now();
  const res = analyzeBuffer(pcm);
  const elapsed = performance.now() - t1;
  const dur = pcm.length / SR;
  samples.push({
    file: f,
    durSec: Math.round(dur * 100) / 100,
    windows: res.windows.length,
    rtf: Math.round((elapsed / (dur * 1000)) * 10000) / 10000,
  });
  process.stdout.write(`  ${f}: ${starts.length} 窗 · RTF ${samples[samples.length - 1].rtf}\n`);
}

allWinMs.sort((a, b) => a - b);
const n = allWinMs.length;
const mean = allWinMs.reduce((a, b) => a + b, 0) / n;
const winMs = {
  n,
  mean: Math.round(mean * 100) / 100,
  p50: Math.round(pct(allWinMs, 50) * 100) / 100,
  p95: Math.round(pct(allWinMs, 95) * 100) / 100,
  p99: Math.round(pct(allWinMs, 99) * 100) / 100,
  max: Math.round(allWinMs[n - 1] * 100) / 100,
};

const rtfs = samples.map((s) => s.rtf).sort((a, b) => a - b);
const rtf = {
  n: rtfs.length,
  p50: Math.round(pct(rtfs, 50) * 10000) / 10000,
  p95: Math.round(pct(rtfs, 95) * 10000) / 10000,
  max: Math.round(rtfs[rtfs.length - 1] * 10000) / 10000,
};

const result = {
  engine: ENGINE_VERSION,
  measuredAt: new Date().toISOString(),
  env: {
    platform: process.platform,
    cpus: typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined,
    node: process.version,
  },
  method: "49 条校准音频全量有能量 2s 窗（RMS≥0.005），预热 2 轮后逐窗 performance.now() 计时；RTF 每条预热 1 次后整段计时",
  windowLatencyMs: winMs,
  rtf,
  samples,
  baselineV201: BASELINE_V201,
};

fs.writeFileSync(
  path.join(process.cwd(), "calibration", "latency_results.json"),
  JSON.stringify(result, null, 2)
);

console.log(`\n═══ 单窗时延（有能量窗 n=${winMs.n}）═══`);
console.log(`  v2.0.0 基线: 均值 ${BASELINE_V201.windowMs.mean} · P50 ${BASELINE_V201.windowMs.p50} · P95 ${BASELINE_V201.windowMs.p95} · P99 ${BASELINE_V201.windowMs.p99} · max ${BASELINE_V201.windowMs.max} ms`);
console.log(`  ${ENGINE_VERSION}: 均值 ${winMs.mean} · P50 ${winMs.p50} · P95 ${winMs.p95} · P99 ${winMs.p99} · max ${winMs.max} ms`);
console.log(`═══ 整段 RTF（n=${rtf.n}）═══`);
console.log(`  v2.0.0 基线: P50 ${BASELINE_V201.rtf.p50} · P95 ${BASELINE_V201.rtf.p95} · max ${BASELINE_V201.rtf.max}`);
console.log(`  ${ENGINE_VERSION}: P50 ${rtf.p50} · P95 ${rtf.p95} · max ${rtf.max}`);
console.log(`\n留档 → calibration/latency_results.json`);
