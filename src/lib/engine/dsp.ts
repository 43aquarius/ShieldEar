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
 * 0 阶修正贝塞尔 I0（Kaiser 窗，级数展开）
 */
function besselI0(x: number): number {
  const h2 = (x / 2) * (x / 2);
  let sum = 1;
  let term = 1;
  for (let n = 1; n < 32; n++) {
    term *= h2 / (n * n);
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

/**
 * 重采样到 16 kHz 单声道（分析标准采样率）· v1.3.9 重写
 *
 * v1.3.5～v1.3.8 实现（逐级对半抽取 + 三点平滑 + 末段线性插值）
 * 抗混叠严重不足：同一段音频若以 44.1/48 kHz 容器提供
 * （如从手机/微信导出），经浏览器解码 → 本函数降采样后
 * 分数会跨档降级（真机审计实测：彤彤 CRITICAL 0.759 →
 * HIGH 0.702）。本段末端线性插值（如 24k→16k、22.05k→16k）
 * 完全无抗混叠，高频成分折叠进低频带污染谱包络。
 *
 * v1.3.9 改为 Kaiser(β≈8.6, ≈80dB 阻带) 窗 sinc 低通 + 多相查表：
 *   · 截止 = min(源奈奎斯特, 8kHz) × 0.98（留 2% 过渡带；实测与 scipy 参考实现分差 ≤ 0.007）
 *   · 单侧 32 抽头（64 taps）× 1024 相位预查表，逐相位增益归一
 *   · 任意比率统一处理（升采样同样适用，通带平坦）
 *   · 16kHz 源恒等返回（零开销；校准集与 v1.3.5-calibrated
 *     引擎判决对 16k 输入完全不受影响）
 */
export function resampleTo16k(input: Float32Array, srcRate: number): Float32Array {
  if (srcRate === 16000) return input;
  if (input.length === 0) return input;

  const step = srcRate / 16000; // 每输出样本的输入域步长
  const outLen = Math.max(1, Math.floor(input.length / step));
  const out = new Float32Array(outLen);

  // 低通截止（归一化到输入采样率，周期/样本）
  const fc = Math.min(0.5, 0.5 / step) * 0.98;
  const TAPS = 32; // 单侧抽头数（总 64 taps）
  const PHASES = 1024; // 相位查表分辨率（相位误差 < 1/1024 样本）
  const BETA = 8.6; // Kaiser β ≈ 80dB 阻带

  // 预生成相位核表：bank[p * K2 + kk]，p∈[0,PHASES)，kk∈[0,2TAPS)
  // 抽头 k ∈ [-TAPS+1, TAPS]，对应输入索引 floor(pos)+k，偏移 t = k - frac
  const K2 = 2 * TAPS;
  const bank = new Float32Array(PHASES * K2);
  const i0Beta = besselI0(BETA);
  for (let p = 0; p < PHASES; p++) {
    const frac = p / PHASES;
    let rowSum = 0;
    for (let k = -TAPS + 1; k <= TAPS; k++) {
      const t = k - frac;
      const x = Math.PI * 2 * fc * t;
      const sinc = x === 0 ? 2 * fc : (2 * fc * Math.sin(x)) / x;
      const r = t / TAPS;
      const w = r <= -1 || r >= 1 ? 0 : besselI0(BETA * Math.sqrt(1 - r * r)) / i0Beta;
      const v = sinc * w;
      bank[p * K2 + (k + TAPS - 1)] = v;
      rowSum += v;
    }
    // 逐相位 DC 增益归一（消除分数相位增益纹波）
    if (rowSum > 1e-9) {
      const g = 1 / rowSum;
      const row = p * K2;
      for (let kk = 0; kk < K2; kk++) bank[row + kk] *= g;
    }
  }

  // 多相插值：out[i] = Σ input[j] · h(j - pos)
  const n = input.length;
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const base = Math.floor(pos);
    const phase = Math.min(PHASES - 1, ((pos - base) * PHASES) | 0);
    const row = phase * K2;
    const jLo = base - TAPS + 1 < 0 ? 0 : base - TAPS + 1;
    const jHi = base + TAPS > n - 1 ? n - 1 : base + TAPS;
    let acc = 0;
    for (let j = jLo; j <= jHi; j++) {
      acc += input[j] * bank[row + (j - base + TAPS - 1)];
    }
    out[i] = acc;
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
