/**
 * 输入质量护栏测试（v2.1）—— 削波 / 直流 / 底噪 / 电平四项诊断 + 引擎直流免疫
 *
 * 实证背景（scripts/probe-robustness.ts，calibration/robustness_results.json）：
 *  - +0.05 直流偏置曾使自然人声误报翻倍（FP 1→2、均值 0.298→0.512），
 *    v2.1 帧级/窗口级去均值后 dc50 与 clean 判决完全一致；
 *  - 258 条判决基线：TP/FP/TN/FN 逐位不变，仅 6 条 CRITICAL→HIGH 档内微移。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { analyzeBuffer, StreamingAnalyzer, assessQuality } from "../engine";
import { decodeWav, mixToMono } from "../../audio/wav";
import { resampleTo16k } from "../dsp";
import {
  ENGINE_VERSION,
  QUALITY_THRESHOLDS,
  QUALITY_ADVICE,
  formatQualityMetrics,
  formatQualitySummary,
  type AudioQuality,
  type QualityWarning,
} from "../types";

const SR = 16000;
const root = path.resolve(__dirname, "../../../..");

/** 真实校准音频（与探针同源同口径：clean 指纹无任何警示） */
function loadPcm16k(file: string): Float32Array {
  const buf = fs.readFileSync(path.join(root, "calibration/audio", file));
  const dec = decodeWav(new Uint8Array(buf).buffer);
  const mono = mixToMono(dec.pcm, dec.channels);
  return resampleTo16k(mono, dec.sampleRate);
}
const REAL_CLEAN = "tts_tongtong_0.wav"; // 探针实测：削波 0 / 直流 ≈0 / 底噪 -86.8dB / 峰值 -3.2dB

/** 固定种子 LCG（与测试套件同款生成器，判决可复现承诺） */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x3fffffff - 1;
  };
}

/** 语音样合成信号：仅用于缺陷注入类用例（纯正弦周期性过强，
 *  平顶比与底噪指纹不适用于「干净」断言 —— 干净口径用真实校准音频） */
function speechLike(seconds: number, amp = 0.4, seed = 20261109): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const syl = 0.575 + 0.425 * Math.sin(2 * Math.PI * 4.5 * t);
    const f0 = 220 * (1 + 0.01 * Math.sin(2 * Math.PI * 0.7 * t));
    out[i] = amp * syl * Math.sin(2 * Math.PI * f0 * t);
  }
  return out;
}

function withDc(x: Float32Array, dc: number): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + dc;
  return out;
}

function clippedTo(x: Float32Array, rail: number): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.min(rail, Math.max(-rail, x[i]));
  return out;
}

function scaled(x: Float32Array, k: number): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * k;
  return out;
}

function withNoiseFloor(x: Float32Array, noiseRms: number, seed = 20261109): Float32Array {
  const rand = lcg(seed);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + rand() * noiseRms * Math.sqrt(3);
  return out;
}

describe("assessQuality（四项诊断阈值，探针实证口径）", () => {
  it("真实校准音频（探针 clean 同源）→ 无任何警示", () => {
    const q = assessQuality(loadPcm16k(REAL_CLEAN));
    expect(q.warnings).toEqual([]);
    expect(q.peakDb).toBeGreaterThan(QUALITY_THRESHOLDS.peakDb);
    expect(Math.abs(q.dcOffset)).toBeLessThan(QUALITY_THRESHOLDS.dcOffset);
    expect(q.noiseFloorDb).toBeLessThan(QUALITY_THRESHOLDS.noiseFloorDb);
  });

  it("+0.05 直流偏置 → dc-offset（且不连带 noisy-floor：底噪在去均值域估计）", () => {
    const q = assessQuality(withDc(loadPcm16k(REAL_CLEAN), 0.05));
    expect(q.dcOffset).toBeCloseTo(0.05, 3);
    expect(q.warnings).toEqual(["dc-offset"]);
  });

  it("硬削波至 ±0.15 → clipping（平顶比口径，可检出非满幅削波）", () => {
    const q = assessQuality(clippedTo(speechLike(4), 0.15));
    expect(q.clippingRatio).toBeGreaterThan(QUALITY_THRESHOLDS.clippingRatio);
    expect(q.warnings).toContain("clipping");
  });

  it("×0.05 极低电平（峰值 < -20dBFS）→ low-level（且平顶比统计自动关闭）", () => {
    const q = assessQuality(scaled(speechLike(4), 0.05));
    expect(q.peakDb).toBeLessThan(QUALITY_THRESHOLDS.peakDb);
    expect(q.warnings).toContain("low-level");
    expect(q.clippingRatio).toBe(0); // 峰值 < minPeak，不统计
  });

  it("白噪底 RMS 0.03（约 -30dBFS）→ noisy-floor", () => {
    const q = assessQuality(withNoiseFloor(speechLike(4), 0.03));
    expect(q.noiseFloorDb).toBeGreaterThan(QUALITY_THRESHOLDS.noiseFloorDb);
    expect(q.warnings).toContain("noisy-floor");
  });

  it("空输入不崩溃（取证边界）", () => {
    const q = assessQuality(new Float32Array(0));
    expect(q.warnings).toEqual([]);
    expect(q.peakDb).toBe(-120);
  });
});

describe("引擎直流免疫（v2.1 帧级/窗口级去均值）", () => {
  it("±0.05 直流偏置下判决不变：ratio 漂移 < 0.02、风险档与语音窗数一致", () => {
    const clean = analyzeBuffer(speechLike(4));
    for (const dc of [0.05, -0.05]) {
      const biased = analyzeBuffer(withDc(speechLike(4), dc));
      expect(Math.abs(biased.overall.syntheticRatio - clean.overall.syntheticRatio)).toBeLessThan(0.02);
      expect(biased.overall.risk).toBe(clean.overall.risk);
      expect(biased.audio.voicedWindows).toBe(clean.audio.voicedWindows);
    }
  });

  it("直流偏置不再击穿静音闸：纯静音 + 0.05DC 仍判静音窗", () => {
    const silent = new Float32Array(SR * 3).fill(0.05); // 恒定直流 = 无语音
    const r = analyzeBuffer(silent);
    expect(r.audio.voicedWindows).toBe(0);
    expect(r.overall.risk).toBe("LOW");
  });
});

describe("质量护栏挂载（整段 + 流式双路径）", () => {
  it("analyzeBuffer 返回完整 quality 结构（真实音频，无警示）", () => {
    const r = analyzeBuffer(loadPcm16k(REAL_CLEAN));
    expect(r.quality).toBeDefined();
    expect(r.quality!.warnings).toEqual([]);
    expect(typeof r.quality!.peakDb).toBe("number");
    expect(typeof r.quality!.noiseFloorDb).toBe("number");
  });

  it("StreamingAnalyzer.finalize 同样携带质量诊断（实时鉴听路径）", () => {
    const sa = new StreamingAnalyzer();
    sa.push(loadPcm16k(REAL_CLEAN));
    const r = sa.finalize();
    expect(r.quality).toBeDefined();
    expect(r.quality!.warnings).toEqual([]);
  });

  it("带缺陷输入的判决结果能同时给出质量警示（analyzeBuffer 端到端）", () => {
    const r = analyzeBuffer(withDc(clippedTo(speechLike(3), 0.2), 0.06));
    expect(r.quality!.warnings).toContain("dc-offset");
    expect(r.quality!.warnings).toContain("clipping");
  });
});

describe("护栏契约（版本与文案完备性）", () => {
  it("引擎版本锚定 v2.1.0-robust（防意外降级）", () => {
    expect(ENGINE_VERSION).toBe("v2.1.0-robust");
  });

  it("每类警示均有非空建议文案（UI/报告同构消费）", () => {
    const all: QualityWarning[] = ["clipping", "dc-offset", "noisy-floor", "low-level"];
    for (const w of all) {
      expect(QUALITY_ADVICE[w].length).toBeGreaterThan(10);
      expect(QUALITY_ADVICE[w]).toContain("检测");
    }
  });
});

describe("质量摘要格式化（报告/面板共用，结论可靠边界呈现）", () => {
  const CLEAN: AudioQuality = {
    clippingRatio: 0.000001,
    dcOffset: 0.0002,
    noiseFloorDb: -86.8,
    peakDb: -3.2,
    warnings: [],
  };

  it("正常输入：四项实测齐全（含直流偏置），无警示段", () => {
    const s = formatQualitySummary(CLEAN);
    expect(s).toContain("正常（");
    expect(s).toContain("削波 0.000%");
    expect(s).toContain("直流偏置 0.02%");
    expect(s).toContain("底噪 -87dBFS");
    expect(s).toContain("峰值 -3.2dBFS");
    expect(s).not.toContain("警示");
    // metrics 与 summary 的数值行一致（全端口径统一）
    expect(s).toContain(formatQualityMetrics(CLEAN));
  });

  it("警示输入：实测四项 + 对应建议文案拼接", () => {
    const q: AudioQuality = {
      ...CLEAN,
      clippingRatio: 0.1,
      dcOffset: 0.05,
      warnings: ["clipping", "dc-offset"],
    };
    const s = formatQualitySummary(q);
    expect(s).toContain("削波 10.000%");
    expect(s).toContain("直流偏置 5.00%");
    expect(s).toContain("｜ 警示：");
    expect(s).toContain(QUALITY_ADVICE.clipping);
    expect(s).toContain(QUALITY_ADVICE["dc-offset"]);
    expect(s).not.toContain("正常（");
  });

  it("metrics 行与 QUALITY_THRESHOLDS 四项一一对应（阈值改动时 UI 不漂移）", () => {
    // 面板阈值行取自 QUALITY_THRESHOLDS 派生，此处锚定阈值与格式化字段的对应关系
    expect(QUALITY_THRESHOLDS.clippingRatio).toBe(0.0002);
    expect(QUALITY_THRESHOLDS.dcOffset).toBe(0.01);
    expect(QUALITY_THRESHOLDS.noiseFloorDb).toBe(-42);
    expect(QUALITY_THRESHOLDS.peakDb).toBe(-20);
    const m = formatQualityMetrics(CLEAN);
    expect(m.match(/·/g)!.length).toBe(3); // 四项由三个间隔符分隔
  });

  it("真实校准音频端到端：clean 样本摘要以「正常（」开头", () => {
    const r = analyzeBuffer(loadPcm16k(REAL_CLEAN));
    expect(r.quality).toBeDefined();
    expect(formatQualitySummary(r.quality!).startsWith("正常（")).toBe(true);
  });
});
