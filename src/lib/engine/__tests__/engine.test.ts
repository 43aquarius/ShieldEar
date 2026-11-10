/**
 * 引擎顶层流程测试：analyzeBuffer / StreamingAnalyzer / summarize
 * 锚定滑窗推进、流式-整段等价性、平滑链、风险档映射、RTF 与确定性。
 * 校准质量（真实数据上的分离度）由 regression.test.ts 负责。
 */
import { describe, it, expect } from "vitest";
import { analyzeBuffer, StreamingAnalyzer, summarize } from "../engine";
import { ENGINE_PARAMS, SCORE_THRESHOLDS, type WindowResult } from "../types";

const SR = ENGINE_PARAMS.sampleRate; // 16000

/** 确定性谐波信号（2s，200Hz，谐波至 3.2kHz） */
function twoSecVoice(): Float32Array {
  const P = SR / 200;
  const H = Math.floor(3200 / 200);
  const out = new Float32Array(32000);
  let ph = 0.7;
  for (let n = 0; n < out.length; n++) {
    let s = 0;
    for (let h = 1; h <= H; h++) s += (1 / h) * Math.sin((2 * Math.PI * h * n) / P + ph * h);
    out[n] = s;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < out.length; i++) out[i] *= 0.6 / peak;
  return out;
}

/** 构造恒定 rawScore 的假窗（检验 summarize 的阈值映射，绕过 DSP） */
function fakeWindows(scores: number[]): WindowResult[] {
  return scores.map((score, i) => ({
    index: i,
    startSec: i,
    endSec: i + 2,
    rawScore: score,
    score,
    label: "natural",
    voiced: true,
    rmsDb: -20,
    channel: "wideband" as const,
    features: {
      hfFlatness: 0, hfEnergyRatio: 0, hnr: 0, hnrCV: 0, fluxCV: 0,
      jitter: 0, zcrCV: 0, hfPeriodicity: 0, f0Std: 0, shimmer: 0,
      envMod45: 0, voicedRatio: 1,
    },
  }));
}

describe("analyzeBuffer", () => {
  it("静音 → LOW，无语音窗，verdict 为自然文案", () => {
    const r = analyzeBuffer(new Float32Array(32000));
    expect(r.overall.risk).toBe("LOW");
    expect(r.audio.voicedWindows).toBe(0);
    expect(r.audio.totalWindows).toBe(1);
    expect(r.overall.verdict).toContain("未发现明显合成特征");
    expect(r.segments).toHaveLength(0);
  });

  it("2s 浊音 → 1 窗，结构完整（11 维剖面 + 引擎元信息）", () => {
    const r = analyzeBuffer(twoSecVoice());
    expect(r.audio.totalWindows).toBe(1);
    expect(r.audio.voicedWindows).toBe(1);
    expect(r.featureProfile).toHaveLength(11);
    for (const item of r.featureProfile) {
      expect(item.naturalPrior).toBeGreaterThan(0);
      expect(Number.isFinite(item.zMean)).toBe(true);
    }
    expect(r.engine.version).toMatch(/^v\d+\.\d+\.\d+/);
    expect(r.channel).toBe("narrowband"); // 谐波截止 3.2kHz → 电话带内
  });

  it("3s 信号 → 2 个滑窗（1s 步进）", () => {
    const pcm = new Float32Array(48000);
    const v = twoSecVoice();
    pcm.set(v.subarray(0, 32000), 0);
    pcm.set(v.subarray(0, 16000), 32000);
    const r = analyzeBuffer(pcm);
    expect(r.audio.totalWindows).toBe(2);
    expect(r.windows[1].startSec).toBeCloseTo(1, 6);
  });

  it("确定性：同输入两次分析结果完全一致（取证可复现承诺）", () => {
    const pcm = twoSecVoice();
    const a = analyzeBuffer(pcm);
    const b = analyzeBuffer(pcm);
    expect(a.windows.map((w) => w.score)).toEqual(b.windows.map((w) => w.score));
    expect(a.overall).toEqual(b.overall);
    expect(a.featureProfile).toEqual(b.featureProfile);
  });

  it("RTF < 0.5（实时性：分析耗时远短于音频时长）", () => {
    const r = analyzeBuffer(twoSecVoice());
    expect(r.stats.rtf).toBeGreaterThan(0);
    expect(r.stats.rtf).toBeLessThan(0.5);
  });

  it("过短输入（<0.4s）→ 零窗、LOW、不崩溃", () => {
    const r = analyzeBuffer(new Float32Array(1000));
    expect(r.audio.totalWindows).toBe(0);
    expect(r.overall.risk).toBe("LOW");
  });
});

describe("StreamingAnalyzer（实时鉴听路径）", () => {
  it("流式滑窗推进 + 尾窗收尾", () => {
    const sa = new StreamingAnalyzer();
    const v = twoSecVoice();
    // 0.5s × 4 块 → 第 4 块后首窗完成
    for (let c = 0; c < 4; c++) {
      sa.push(v.subarray(c * 8000, (c + 1) * 8000));
      const p = sa.poll();
      expect(p.newWindows.length).toBe(c === 3 ? 1 : 0);
    }
    // 再喂 1s → 第二窗（起点 1s）完成
    sa.push(new Float32Array(16000).fill(0));
    const p2 = sa.poll();
    expect(p2.newWindows.length).toBe(1);
    expect(p2.all.length).toBe(2);
    const r = sa.finalize();
    // 尾窗：48000 − 2×16000 = 16000 ≥ 3200 → 收一个尾窗
    expect(r.audio.totalWindows).toBe(3);
    expect(r.audio.durationSec).toBeCloseTo(3, 6);
    expect(r.stats.analyzeMs).toBeGreaterThanOrEqual(0);
  });

  it("recordedSamples 跟踪", () => {
    const sa = new StreamingAnalyzer();
    sa.push(new Float32Array(1234));
    expect(sa.recordedSamples).toBe(1234);
  });
});

describe("summarize（阈值映射与文案）", () => {
  it("风险档映射：0.9→CRITICAL · 0.6→HIGH · 0.4→MEDIUM · 0.2→LOW", () => {
    expect(summarize(fakeWindows([0.9, 0.9, 0.9]), 6, 1).overall.risk).toBe("CRITICAL");
    expect(summarize(fakeWindows([0.6, 0.6]), 4, 1).overall.risk).toBe("HIGH");
    expect(summarize(fakeWindows([0.4, 0.4]), 4, 1).overall.risk).toBe("MEDIUM");
    expect(summarize(fakeWindows([0.2, 0.2]), 4, 1).overall.risk).toBe("LOW");
  });

  it("窗口标签：0.9→synthetic · 0.6→suspect · 0.4→natural（平滑链后）", () => {
    const mk = (s: number) => summarize(fakeWindows([s, s, s]), 6, 1);
    expect(mk(0.9).windows[1].label).toBe("synthetic");
    expect(mk(0.6).windows[1].label).toBe("suspect");
    expect(mk(0.4).windows[1].label).toBe("natural");
  });

  it("可疑片段聚合：连续高危窗合并为单一片段（平滑链后）", () => {
    // EMA 平滑链会使阶跃渐升（0.35 系数），故用持续高危序列验证合并语义
    const r = summarize(fakeWindows([0.9, 0.9, 0.9, 0.9, 0.9]), 10, 1);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].windows).toBe(5);
    expect(r.segments[0].peakScore).toBeGreaterThan(0.85);
    // 边界：首尾低分窗不纳入片段
    const b = summarize(fakeWindows([0.1, 0.9, 0.9, 0.9, 0.1]), 10, 1);
    expect(b.segments).toHaveLength(1);
    expect(b.segments[0].startSec).toBeGreaterThanOrEqual(1);
  });

  it("全静音窗 → LOW（voiced=0 除零保护）", () => {
    const silent = fakeWindows([0.5]).map((w) => ({ ...w, voiced: false, rawScore: 0 }));
    const r = summarize(silent, 2, 1);
    expect(r.overall.risk).toBe("LOW");
    expect(r.overall.syntheticRatio).toBe(0);
  });

  it("文案与阈值常量一致（CRITICAL 提示反诈动作）", () => {
    const r = summarize(fakeWindows([0.95]), 2, 1);
    expect(r.overall.verdict).toContain("高度疑似");
    expect(r.overall.advice).toContain("96110");
    expect(SCORE_THRESHOLDS.risk.critical).toBe(0.75);
  });
});
