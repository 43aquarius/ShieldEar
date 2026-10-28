/**
 * 声盾 ShieldEar 引擎 — 数字信号处理基础库（同构：浏览器 / Node 均可运行）
 * 包含：FFT、窗函数、自相关基音分析、重采样、统计工具
 */

/** 缓存的 Hann 窗（按长度） */
const hannCache = new Map<number, Float64Array>();

export function getHann(n: number): Float64Array {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    }
    hannCache.set(n, w);
  }
  return w;
}

/**
 * 迭代式 radix-2 原地 FFT（n 必须为 2 的幂）
 */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // 位反转置换
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  // 蝶形运算
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + half], bi = im[i + k + half];
        const vr = br * wr - bi * wi;
        const vi = br * wi + bi * wr;
        re[i + k] = ar + vr;
        im[i + k] = ai + vi;
        re[i + k + half] = ar - vr;
        im[i + k + half] = ai - vi;
      }
    }
  }
}

/**
 * 计算一帧的幅度谱（长度 fftSize/2+1）
 * @param frame 输入帧（任意长度，内部加 Hann 后补零到 fftSize）
 */
export function magnitudeSpectrum(
  frame: Float32Array | Float64Array,
  fftSize: number
): Float64Array {
  const n = frame.length;
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const w = getHann(n);
  for (let i = 0; i < n; i++) {
    re[i] = frame[i] * w[i];
  }
  fftInPlace(re, im);
  const bins = (fftSize >> 1) + 1;
  const mag = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  }
  return mag;
}

/** 段内 RMS（均方根） */
export function rms(x: Float32Array, start: number, len: number): number {
  let s = 0;
  const end = Math.min(start + len, x.length);
  const n = Math.max(1, end - start);
  for (let i = start; i < end; i++) s += x[i] * x[i];
  return Math.sqrt(s / n);
}

/** dB（相对满量程） */
export function toDb(v: number): number {
  return 20 * Math.log10(Math.max(v, 1e-10));
}

export interface AutocorrPeak {
  /** 整数延迟（采样点） */
  lag: number;
  /** 抛物线插值精化后的延迟 */
  refined: number;
  /** 归一化自相关峰值（-1..1，可用作 HNR 代理） */
  value: number;
}

/**
 * 自相关基音分析：在 [minLag, maxLag] 内找峰值并抛物线插值精化
 * 返回归一化峰值（谐波噪声比 HNR 的代理）与精化后的周期
 */
export function autocorrPeak(
  x: Float32Array,
  start: number,
  len: number,
  minLag: number,
  maxLag: number
): AutocorrPeak {
  const end = start + len;
  // 归一化能量（分母）
  let e0 = 0;
  for (let i = start; i < end; i++) e0 += x[i] * x[i];
  if (e0 < 1e-12) return { lag: 0, refined: 0, value: 0 };

  let bestLag = -1;
  let bestVal = -2;
  for (let lag = minLag; lag <= maxLag && start + lag < end; lag++) {
    let s = 0;
    const lim = end - lag;
    for (let i = start; i < lim; i++) s += x[i] * x[i + lag];
    const v = s / e0; // 有偏归一化
    if (v > bestVal) {
      bestVal = v;
      bestLag = lag;
    }
  }
  if (bestLag < 0) return { lag: 0, refined: 0, value: 0 };

  // 抛物线插值精化
  let refined = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const vM = corrAt(x, start, end, bestLag - 1, e0);
    const v0 = bestVal;
    const vP = corrAt(x, start, end, bestLag + 1, e0);
    const denom = vM - 2 * v0 + vP;
    if (Math.abs(denom) > 1e-12) {
      const delta = 0.5 * (vM - vP) / denom;
      if (Math.abs(delta) <= 1) refined = bestLag + delta;
    }
  }
  return { lag: bestLag, refined, value: bestVal };
}

function corrAt(
  x: Float32Array,
  start: number,
  end: number,
  lag: number,
  e0: number
): number {
  let s = 0;
  const lim = end - lag;
  for (let i = start; i < lim; i++) s += x[i] * x[i + lag];
  return s / e0;
}

/**
 * 简易抗混叠整数抽取（[0.25,0.5,0.25] 平滑 + 抽取）
 */
function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return x;
  const outLen = Math.floor(x.length / factor);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const c = i * factor;
    const i0 = Math.floor(c) === c ? c : Math.floor(c);
    const prev = i0 > 0 ? x[i0 - 1] : x[0];
    const cur = x[i0];
    const next = i0 + 1 < x.length ? x[i0 + 1] : cur;
    // 三点平滑滤波
    out[i] = 0.25 * prev + 0.5 * cur + 0.25 * next;
  }
  return out;
}

/**
 * 重采样到 16 kHz 单声道（分析标准采样率）
 * 策略：先整数抽取到 ≥16k 的最低倍率，再线性插值到 16k；任何重采样前先平滑抑制混叠
 */
export function resampleTo16k(input: Float32Array, srcRate: number): Float32Array {
  if (srcRate === 16000) return input;
  let x = input;
  let rate = srcRate;
  // 逐级减半抽取（带平滑），直至 rate/2 < 16000 或不能再整除
  while (rate % 2 === 0 && rate / 2 >= 16000) {
    x = decimate(x, 2);
    rate /= 2;
  }
  if (rate === 16000) return x;
  // 线性插值到 16k
  const ratio = rate / 16000;
  const outLen = Math.max(1, Math.floor(x.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = x[i0] ?? 0;
    const b = x[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** 三点中值滤波（平滑异常窗） */
export function median3(scores: number[]): number[] {
  const out = new Array<number>(scores.length);
  for (let i = 0; i < scores.length; i++) {
    if (i === 0 || i === scores.length - 1) {
      out[i] = scores[i];
    } else {
      const a = scores[i - 1], b = scores[i], c = scores[i + 1];
      out[i] = a + b + c - Math.min(a, b, c) - Math.max(a, b, c);
    }
  }
  return out;
}

/** 指数滑动平均 */
export function ema(series: number[], alpha: number): number[] {
  const out = new Array<number>(series.length);
  let acc: number | null = null;
  for (let i = 0; i < series.length; i++) {
    acc = acc === null ? series[i] : alpha * series[i] + (1 - alpha) * acc;
    out[i] = acc;
  }
  return out;
}

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const v of xs) s += (v - m) * (v - m);
  return Math.sqrt(s / (xs.length - 1));
}

/** logistic */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** 限幅 */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
