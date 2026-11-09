/**
 * 引擎时延回归钉（v1.3.15 引入）—— 单窗 P99 / 中位 / 整段 RTF
 *
 * 基线（scripts/probe-latency-p99.ts，calibration/latency_results.json）：
 *  - 引擎 v2.1.0-robust，49 条校准音频全量 1004 个有能量 2s 窗（RMS≥0.005，预热 2 轮）：
 *    均值 7.09ms · P50 7.11ms · P95 8.92ms · P99 10.17ms · max 33ms（单发 GC/调度离群）
 *  - 整段 RTF：P50 0.0065 · P95 0.0083 · max 0.0095
 *  - 对照 v2.0.0 文档基线（系统测试报告 §6.1，160 窗）：P99 9.65ms、RTF P50 0.0068——
 *    v2.1 质量护栏/直流免疫不在每窗热路径，无劣化。
 *
 * 钉子定位：捕获「数量级劣化」回归（如误在窗内引入 O(n²) 统计、重复 FFT），
 * 断言上限为实测值的 8–10 倍，CI 低配 runner 抖动余量充足（vitest.config 注释先例）。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { analyzeBuffer, analyzeWindow } from "../engine";
import { decodeWav, mixToMono } from "../../audio/wav";
import { resampleTo16k } from "../dsp";

const SR = 16000;
const WIN = 2 * SR;
const HOP = 1 * SR;
const ENERGY_GATE = 0.005; // 与引擎静音闸同口径：RMS ≥ 0.005 视为有能量窗

const root = path.resolve(__dirname, "../../../..");

/** 真实校准音频（与探针同源：ws_librivox_16k.wav 窗数最多，261 窗） */
function loadPcm16k(file: string): Float32Array {
  const buf = fs.readFileSync(path.join(root, "calibration/audio", file));
  const dec = decodeWav(new Uint8Array(buf).buffer);
  const mono = mixToMono(dec.pcm, dec.channels);
  return resampleTo16k(mono, dec.sampleRate);
}

function pct(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

describe("引擎时延回归钉（单窗 P99 / RTF）", () => {
  it("单窗时延：P99 < 100ms 且中位 < 25ms（基线 P99 10.17ms，10 倍抖动余量）", () => {
    const pcm = loadPcm16k("ws_librivox_16k.wav");
    const starts: number[] = [];
    for (let s = 0; s + WIN <= pcm.length; s += HOP) {
      let sq = 0;
      let n = 0;
      for (let i = s; i < s + WIN; i += 4) {
        sq += pcm[i] * pcm[i];
        n++;
      }
      if (Math.sqrt(sq / n) >= ENERGY_GATE && (s / HOP) % 2 === 0) starts.push(s); // 隔窗取样：控 CI 耗时
    }
    expect(starts.length).toBeGreaterThan(50); // 样本窗数充足，分位数才有意义

    // JIT 预热 2 轮后正式计时（与探针同口径）
    for (let r = 0; r < 2; r++) for (const s of starts) analyzeWindow(pcm, s, 0);
    const ms: number[] = [];
    for (const s of starts) {
      const t0 = performance.now();
      analyzeWindow(pcm, s, 0);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    const p99 = pct(ms, 99);
    const p50 = pct(ms, 50);
    expect(p99).toBeLessThan(100);
    expect(p50).toBeLessThan(25);
  });

  it("整段 RTF < 0.05（基线 max 0.0095，5 倍余量；较原 0.5 钉收紧 10 倍）", () => {
    const pcm = loadPcm16k("ws_demo_16k.wav");
    analyzeBuffer(pcm); // 预热
    const t0 = performance.now();
    const r = analyzeBuffer(pcm);
    const rtf = (performance.now() - t0) / ((pcm.length / SR) * 1000);
    expect(r.windows.length).toBeGreaterThan(0);
    expect(rtf).toBeLessThan(0.05);
  });
});
