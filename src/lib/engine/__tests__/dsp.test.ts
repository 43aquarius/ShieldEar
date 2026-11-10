/**
 * DSP 基础库数学契约测试
 * 锚定 FFT / 窗函数 / 自相关基音 / 重采样 / 统计工具的正确性 ——
 * 引擎 v2.0 全部 11 维特征都建立在这些原语之上，任何一处符号或
 * 归一化错误都会在这里先爆炸，而不是在 258 条判决里静默漂移。
 */
import { describe, it, expect } from "vitest";
import {
  getHann,
  fftInPlace,
  magnitudeSpectrum,
  rms,
  toDb,
  autocorrPeak,
  median3,
  ema,
  mean,
  std,
  sigmoid,
  clamp,
  resampleTo16k,
} from "../dsp";

/** 确定性 PRNG（mulberry32）—— 测试信号可复现 */
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

describe("fftInPlace", () => {
  it("单位冲激 → 全频段平坦谱（|X[k]|=1）", () => {
    const N = 512;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    re[0] = 1;
    fftInPlace(re, im);
    for (let k = 0; k < N; k++) {
      const mag = Math.hypot(re[k], im[k]);
      expect(Math.abs(mag - 1)).toBeLessThan(1e-10);
    }
  });

  it("第 3 bin 余弦 → 峰值仅在 bin 3 与共轭 bin N-3，幅度 N/2", () => {
    const N = 512;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let n = 0; n < N; n++) re[n] = Math.cos((2 * Math.PI * 3 * n) / N);
    fftInPlace(re, im);
    const magAt = (k: number) => Math.hypot(re[k], im[k]);
    expect(magAt(3)).toBeCloseTo(N / 2, 6);
    expect(magAt(N - 3)).toBeCloseTo(N / 2, 6);
    // 其余 bin 近似为零（无窗整周期截断，泄漏仅数值噪声）
    for (let k = 0; k < N; k++) {
      if (k !== 3 && k !== N - 3) expect(magAt(k)).toBeLessThan(1e-8);
    }
  });

  it("Parseval 定理：Σ|x|² = (1/N)Σ|X|²（随机信号）", () => {
    const N = 256;
    const rnd = prng(7);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    let timeEnergy = 0;
    for (let n = 0; n < N; n++) {
      re[n] = rnd() * 2 - 1;
      timeEnergy += re[n] * re[n];
    }
    fftInPlace(re, im);
    let freqEnergy = 0;
    for (let k = 0; k < N; k++) freqEnergy += re[k] * re[k] + im[k] * im[k];
    expect(freqEnergy / N).toBeCloseTo(timeEnergy, 6);
  });

  it("线性性：FFT(a·x + b·y) = a·FFT(x) + b·FFT(y)", () => {
    const N = 128;
    const rnd = prng(21);
    const x = new Float64Array(N);
    const y = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      x[n] = rnd() * 2 - 1;
      y[n] = rnd() * 2 - 1;
    }
    const mixRe = new Float64Array(N);
    for (let n = 0; n < N; n++) mixRe[n] = 0.7 * x[n] - 1.3 * y[n];
    const mixIm = new Float64Array(N);
    fftInPlace(mixRe, mixIm);

    const xr = Float64Array.from(x);
    const xi = new Float64Array(N);
    fftInPlace(xr, xi);
    const yr = Float64Array.from(y);
    const yi = new Float64Array(N);
    fftInPlace(yr, yi);
    for (let k = 0; k < N; k++) {
      const er = 0.7 * xr[k] - 1.3 * yr[k];
      const ei = 0.7 * xi[k] - 1.3 * yi[k];
      expect(Math.abs(mixRe[k] - er)).toBeLessThan(1e-10);
      expect(Math.abs(mixIm[k] - ei)).toBeLessThan(1e-10);
    }
  });

  it("逆变换往返（引擎共轭技巧）：虚部取负再正变换，实部/N ≈ 原信号", () => {
    // engine.ts 高频段周期性提取使用此技巧做实信号 IFFT，此处锚定其正确性
    const N = 512;
    const rnd = prng(99);
    const re = new Float64Array(N);
    for (let n = 0; n < N; n++) re[n] = rnd() * 2 - 1;
    const Xr = Float64Array.from(re);
    const Xi = new Float64Array(N);
    fftInPlace(Xr, Xi);
    for (let i = 0; i < N; i++) Xi[i] = -Xi[i];
    fftInPlace(Xr, Xi);
    for (let i = 0; i < N; i++) {
      expect(Xr[i] / N).toBeCloseTo(re[i], 8);
      expect(Math.abs(Xi[i]) / N).toBeLessThan(1e-9);
    }
  });
});

describe("magnitudeSpectrum", () => {
  it("25ms 帧 @16kHz 的 1kHz 正弦 → 峰值 bin = 32（512 点 FFT）", () => {
    const frame = new Float32Array(400);
    for (let n = 0; n < 400; n++) frame[n] = Math.sin((2 * Math.PI * 1000 * n) / 16000);
    const mag = magnitudeSpectrum(frame, 512);
    expect(mag.length).toBe(257);
    let peakBin = 0;
    for (let k = 1; k < mag.length; k++) if (mag[k] > mag[peakBin]) peakBin = k;
    expect(peakBin).toBe(32); // 1000 / (16000/512) = 32
  });
});

describe("getHann", () => {
  it("对称、端点为零、中心为 1、均值≈0.5", () => {
    const n = 401;
    const w = getHann(n);
    expect(w[0]).toBeCloseTo(0, 12);
    expect(w[n - 1]).toBeCloseTo(0, 12);
    expect(w[(n - 1) / 2]).toBeCloseTo(1, 12);
    expect(w[100]).toBeCloseTo(w[n - 1 - 100], 12); // 对称
    expect(mean(Array.from(w))).toBeCloseTo(0.5, 2); // 离散口径与连续值差 O(1/n)
  });

  it("同长度窗缓存复用（同一引用）", () => {
    expect(getHann(400)).toBe(getHann(400));
  });
});

describe("rms / toDb", () => {
  it("已知段落 RMS", () => {
    const x = new Float32Array([1, -1, 1, -1]);
    expect(rms(x, 0, 4)).toBeCloseTo(1, 12);
    const y = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    expect(rms(y, 0, 4)).toBeCloseTo(0.5, 12);
  });

  it("段越界安全（统计范围收缩到数组末尾）", () => {
    const x = new Float32Array([1, 1, 1, 1]);
    expect(rms(x, 2, 10)).toBeCloseTo(1, 12);
  });

  it("toDb：1→0dB，0.5→−6.02dB，零值被下限保护", () => {
    expect(toDb(1)).toBeCloseTo(0, 10);
    expect(toDb(0.5)).toBeCloseTo(-6.0206, 3);
    expect(toDb(0)).toBeLessThan(-190); // 1e-10 下限 → −200dB
  });
});

describe("autocorrPeak", () => {
  it("200Hz 正弦（8kHz 域，周期 40 样本）→ 精化周期≈40，归一化峰值>0.85", () => {
    const len = 400;
    const x = new Float32Array(len);
    for (let n = 0; n < len; n++) x[n] = Math.sin((2 * Math.PI * 200 * n) / 8000);
    const p = autocorrPeak(x, 0, len, 20, 133);
    expect(p.lag).toBe(40);
    expect(Math.abs(p.refined - 40)).toBeLessThan(0.1);
    expect(p.value).toBeGreaterThan(0.85);
  });

  it("白噪声 → 峰值低（无周期结构）", () => {
    const rnd = prng(5);
    const x = new Float32Array(400);
    for (let n = 0; n < 400; n++) x[n] = rnd() * 2 - 1;
    const p = autocorrPeak(x, 0, 400, 20, 133);
    expect(p.value).toBeLessThan(0.5);
  });

  it("静音段 → 返回零（不除零）", () => {
    const x = new Float32Array(400);
    const p = autocorrPeak(x, 0, 400, 20, 133);
    expect(p.value).toBe(0);
    expect(p.refined).toBe(0);
  });
});

describe("median3 / ema", () => {
  it("median3：中间元素取邻域中值，端点保持", () => {
    expect(median3([5, 1, 9, 3, 7])).toEqual([5, 5, 3, 7, 7]);
    // 浮点输入走 a+b+c−min−max 公式，存在可容浮点噪声，逐元素近断言
    const m = median3([0.1, 0.9, 0.2]);
    expect(m[0]).toBeCloseTo(0.1, 10);
    expect(m[1]).toBeCloseTo(0.2, 10);
    expect(m[2]).toBeCloseTo(0.2, 10);
    expect(median3([])).toEqual([]);
  });

  it("ema：α=1 恒等；α=0 首值冻结；递推公式", () => {
    const s = [1, 2, 3, 4];
    expect(ema(s, 1)).toEqual(s);
    expect(ema(s, 0)).toEqual([1, 1, 1, 1]);
    expect(ema(s, 0.5)).toEqual([1, 1.5, 2.25, 3.125]);
  });
});

describe("mean / std / sigmoid / clamp", () => {
  it("mean/std（样本标准差 n-1）", () => {
    expect(mean([])).toBe(0);
    expect(mean([2, 4])).toBe(3);
    expect(std([1])).toBe(0);
    expect(std([1, 2, 3])).toBeCloseTo(1, 12);
  });

  it("sigmoid：0→0.5，单调，饱和", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(1)).toBeGreaterThan(0.5);
    expect(sigmoid(-1)).toBeLessThan(0.5);
    expect(sigmoid(500)).toBeCloseTo(1, 12);
    expect(sigmoid(-500)).toBeCloseTo(0, 12);
  });

  it("clamp 限幅", () => {
    expect(clamp(5, -3, 3)).toBe(3);
    expect(clamp(-5, -3, 3)).toBe(-3);
    expect(clamp(1, -3, 3)).toBe(1);
  });
});

describe("resampleTo16k（v1.3.9 Kaiser sinc 重写）", () => {
  it("16kHz 源恒等返回（零开销路径，同引用）", () => {
    const x = new Float32Array(1000).fill(0.5);
    expect(resampleTo16k(x, 16000)).toBe(x);
  });

  it("空输入安全", () => {
    expect(resampleTo16k(new Float32Array(0), 44100).length).toBe(0);
  });

  it("48k→16k：440Hz 正弦保真（幅度 + 谱峰位置）", () => {
    const SR = 48000;
    const n = SR; // 1s
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / SR);
    const out = resampleTo16k(x, SR);
    expect(out.length).toBe(16000);
    // RMS 保持（通带增益≈1）
    const outRms = Math.sqrt(mean(Array.from(out).map((v) => v * v)));
    expect(outRms).toBeCloseTo(0.8 / Math.SQRT2, 2);
    // 谱峰在 440Hz 附近
    const fftSize = 4096;
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < Math.min(fftSize, out.length); i++) re[i] = out[i];
    fftInPlace(re, im);
    let peakBin = 0;
    for (let k = 1; k < fftSize / 2; k++) {
      if (Math.hypot(re[k], im[k]) > Math.hypot(re[peakBin], im[peakBin])) peakBin = k;
    }
    const peakHz = (peakBin * 16000) / fftSize;
    expect(Math.abs(peakHz - 440)).toBeLessThan(8);
  });

  it("48k→16k：12kHz 带外音调被抗混叠抑制（≥40dB）", () => {
    // v1.3.5–v1.3.8 旧实现正是栽在这里：带外能量折叠进低频污染谱包络
    const SR = 48000;
    const n = SR;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 12000 * i) / SR);
    const out = resampleTo16k(x, SR);
    const inRms = Math.sqrt(mean(Array.from(x).map((v) => v * v)));
    const outRms = Math.sqrt(mean(Array.from(out).map((v) => v * v)));
    expect(outRms / inRms).toBeLessThan(0.01); // −40dB
  });

  it("44.1k→16k：输出长度 = floor(len × 16000/44100)", () => {
    const x = new Float32Array(44100);
    const out = resampleTo16k(x, 44100);
    expect(out.length).toBe(Math.floor(44100 / (44100 / 16000)));
  });
});
