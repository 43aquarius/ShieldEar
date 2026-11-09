/**
 * analyzeWindow 特征提取测试（合成信号 → 已知物理特性）
 *
 * 合成器：谐波声门脉冲模型 —— 逐周期拼接波形片段，可独立注入
 *   · 周期扰动（→ jitter）      · 幅度扰动（→ shimmer）
 *   · 基频扫频（→ f0Std）       · 4–8Hz 幅度调制（→ envMod45）
 *   · 谐波延展上限（→ 信道判定 / 高频特征）
 * 常数基准（零扰动）下 jitter / shimmer / f0Std 必须精确为零 ——
 * 这是"测量的是注入的扰动而非数值噪声"的对照实验。
 */
import { describe, it, expect } from "vitest";
import { analyzeWindow } from "../engine";
import { ENGINE_PARAMS, type ChannelType } from "../types";

const SR = 16000;

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface VoiceOpts {
  seconds?: number;
  f0?: number; // Hz
  topHz?: number; // 谐波延展上限
  rolloff?: number; // 谐波幅度 ∝ h^(-rolloff)，0=平谱 1=自然滚降
  periodJitter?: number; // 每周期长度相对扰动幅度（如 0.015 = ±1.5%）
  ampJitter?: number; // 每周期幅度相对扰动幅度
  f0Sweep?: number; // 1.2 → 周期从 1.2P 线性变到 0.8P（F0 上扫）
  amDepth?: number; // 4–8Hz 调制深度
  amHz?: number;
  seed?: number;
}

/** 谐波声门脉冲合成器（确定性） */
function voiceLike(o: VoiceOpts = {}): Float32Array {
  const {
    seconds = 2,
    f0 = 200,
    topHz = 3200,
    rolloff = 1,
    periodJitter = 0,
    ampJitter = 0,
    f0Sweep = 0,
    amDepth = 0,
    amHz = 5,
    seed = 42,
  } = o;
  const rnd = prng(seed);
  const P = SR / f0;
  const H = Math.max(1, Math.floor(topHz / f0));
  const phases = Array.from({ length: H }, () => rnd() * 2 * Math.PI);
  // 单周期波形（以 P 为周期长度）
  const w = new Float32Array(Math.round(P));
  for (let n = 0; n < w.length; n++) {
    let s = 0;
    for (let h = 1; h <= H; h++) {
      s += Math.pow(h, -rolloff) * Math.sin((2 * Math.PI * h * n) / P + phases[h - 1]);
    }
    w[n] = s;
  }
  const total = Math.round(seconds * SR);
  const out = new Float32Array(total);
  const periods = Math.ceil(total / P) + 2;
  // 逐周期长度与幅度（扫频 / 周期扰动 / 幅度扰动在此注入）
  const lens: number[] = [];
  const amps: number[] = [];
  for (let k = 0; k < periods; k++) {
    let len = P;
    if (f0Sweep) {
      // 周期从 f0Sweep·P 线性过渡到 (2−f0Sweep)·P（保持均值 ≈ P）
      const t = k / periods;
      len = P * (f0Sweep + t * (2 - 2 * f0Sweep));
    }
    if (periodJitter) len *= 1 + periodJitter * (rnd() * 2 - 1);
    lens[k] = Math.max(8, Math.round(len));
    amps[k] = ampJitter ? 1 + ampJitter * (rnd() * 2 - 1) : 1;
  }
  let pos = 0;
  for (let k = 0; k < periods && pos < total; k++) {
    const L = lens[k];
    for (let n = 0; n < L && pos < total; n++, pos++) {
      const src = w[Math.min(w.length - 1, Math.floor((n * w.length) / L))];
      let amp = amps[k];
      if (amDepth) amp *= 1 + amDepth * Math.cos((2 * Math.PI * amHz * pos) / SR);
      out[pos] = amp * src;
    }
  }
  // 归一化到峰值 0.6（远高于 0.005 帧活跃阈）
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.6 / peak;
  return out;
}

describe("浊音检测与谐波特征", () => {
  it("谐波信号 → voiced，hnr>0.75，jitter/shimmer/f0Std 精确为零（零扰动对照）", () => {
    const pcm = voiceLike({ f0: 200, topHz: 3200 });
    const w = analyzeWindow(pcm, 0, 0);
    expect(w.voiced).toBe(true);
    expect(w.features.hnr).toBeGreaterThan(0.75);
    expect(w.features.jitter).toBeLessThan(1e-6);
    expect(w.features.shimmer).toBeLessThan(1e-6);
    expect(w.features.f0Std).toBeLessThan(1e-6);
    expect(w.features.voicedRatio).toBeGreaterThan(0.9);
  });

  it("谐波延展到 7.4kHz → 高频周期性显著（声码器指纹方向）", () => {
    const bright = analyzeWindow(voiceLike({ topHz: 7400, rolloff: 0 }), 0, 0);
    const dark = analyzeWindow(voiceLike({ topHz: 3200 }), 0, 0);
    expect(bright.features.hfPeriodicity).toBeGreaterThan(0.5);
    expect(bright.features.hfPeriodicity).toBeGreaterThan(dark.features.hfPeriodicity);
  });

  it("白噪声 → 低 hnr、高谱平坦度（对照谐波信号）", () => {
    const rnd = prng(7);
    const noise = new Float32Array(32000);
    for (let i = 0; i < noise.length; i++) noise[i] = 0.3 * (rnd() * 2 - 1);
    const w = analyzeWindow(noise, 0, 0);
    const harm = analyzeWindow(voiceLike({ topHz: 7400, rolloff: 0 }), 0, 0);
    expect(w.features.hnr).toBeLessThan(0.5);
    expect(w.features.hfFlatness).toBeGreaterThan(harm.features.hfFlatness + 0.1);
    expect(w.features.hfFlatness).toBeGreaterThan(0.45);
  });
});

describe("v2.0 新特征（f0Std / shimmer / envMod45）的注入响应", () => {
  it("基频扫频（167→250Hz）→ f0Std > 0.05；常数基频 → ≈0", () => {
    const flat = analyzeWindow(voiceLike({ f0: 200, topHz: 3200 }), 0, 0);
    const sweep = analyzeWindow(voiceLike({ f0: 200, topHz: 3200, f0Sweep: 1.2 }), 0, 0);
    expect(flat.features.f0Std).toBeLessThan(1e-6);
    expect(sweep.features.f0Std).toBeGreaterThan(0.05);
  });

  it("周期扰动 ±1.5% → jitter > 0.002；零扰动 → ≈0", () => {
    const flat = analyzeWindow(voiceLike({ topHz: 3200 }), 0, 0);
    const jit = analyzeWindow(voiceLike({ topHz: 3200, periodJitter: 0.015 }), 0, 0);
    expect(flat.features.jitter).toBeLessThan(1e-6);
    expect(jit.features.jitter).toBeGreaterThan(0.002);
  });

  it("幅度扰动 ±15% → shimmer > 0.02；零扰动 → ≈0", () => {
    const flat = analyzeWindow(voiceLike({ topHz: 3200 }), 0, 0);
    const shim = analyzeWindow(voiceLike({ topHz: 3200, ampJitter: 0.15 }), 0, 0);
    expect(flat.features.shimmer).toBeLessThan(1e-6);
    expect(shim.features.shimmer).toBeGreaterThan(0.02);
  });

  it("5Hz 幅度调制 → envMod45 显著且高于未调制对照", () => {
    const plain = analyzeWindow(voiceLike({ topHz: 3200 }), 0, 0);
    const am = analyzeWindow(voiceLike({ topHz: 3200, amDepth: 0.6, amHz: 5 }), 0, 0);
    expect(am.features.envMod45).toBeGreaterThan(0.3);
    expect(am.features.envMod45).toBeGreaterThan(plain.features.envMod45 + 0.15);
  });
});

describe("信道判定（v2.0 修复的 3.5kHz 功率占比判据）", () => {
  it("谐波延展至 7.4kHz → wideband", () => {
    const w = analyzeWindow(voiceLike({ topHz: 7400, rolloff: 0 }), 0, 0);
    expect(w.channel).toBe("wideband");
  });

  it("谐波截止于 3.2kHz（电话带内模拟）→ narrowband", () => {
    const w = analyzeWindow(voiceLike({ topHz: 3200 }), 0, 0);
    expect(w.channel).toBe("narrowband");
  });

  it("forcedChannel 覆盖自动判定", () => {
    const pcm = voiceLike({ topHz: 7400, rolloff: 0 });
    expect(analyzeWindow(pcm, 0, 0, { forcedChannel: "narrowband" }).channel).toBe("narrowband");
    expect(analyzeWindow(pcm, 0, 0, { forcedChannel: "wideband" as ChannelType }).channel).toBe("wideband");
  });
});

describe("边界与确定性", () => {
  it("静音窗 → 不判语音，得分为零", () => {
    const w = analyzeWindow(new Float32Array(32000), 0, 0);
    expect(w.voiced).toBe(false);
    expect(w.rawScore).toBe(0);
    expect(w.label).toBe("silent");
  });

  it("过短窗口（<2s）安全处理，帧数收缩", () => {
    const pcm = voiceLike({ seconds: 1, topHz: 3200 });
    const w = analyzeWindow(pcm, 0, 0);
    expect(w.endSec).toBeCloseTo(1, 6);
    expect(Number.isFinite(w.features.hnr)).toBe(true);
  });

  it("同一输入两次分析 → 特征逐位一致（判决可复现）", () => {
    const pcm = voiceLike({ topHz: 3200, periodJitter: 0.01, ampJitter: 0.1 });
    const a = analyzeWindow(pcm, 0, 0);
    const b = analyzeWindow(pcm, 0, 0);
    expect(a.features).toEqual(b.features);
    expect(a.rawScore).toBe(b.rawScore);
  });

  it("所有特征值有界（0 ≤ x ≤ 1 或变异系数 ≥ 0）且非 NaN", () => {
    const cases = [
      voiceLike({ topHz: 7400, rolloff: 0 }),
      voiceLike({ topHz: 3200, periodJitter: 0.02, ampJitter: 0.2 }),
      (() => {
        const rnd = prng(3);
        const x = new Float32Array(32000);
        for (let i = 0; i < x.length; i++) x[i] = 0.2 * (rnd() * 2 - 1);
        return x;
      })(),
    ];
    for (const pcm of cases) {
      const w = analyzeWindow(pcm, 0, 0);
      const f = w.features;
      for (const v of Object.values(f)) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
      // 有界特征（比例/平坦度/周期性）≤ 1
      for (const k of ["hfFlatness", "hfEnergyRatio", "hnr", "hfPeriodicity", "envMod45", "voicedRatio"] as const) {
        expect(f[k]).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});
