/**
 * 声盾 — 轻量 radix-2 FFT（客户端时频分析用）
 * 经典 Cooley-Turkey 原位迭代实现，零依赖零联网
 */

/** 就地计算复数 FFT（n 必须为 2 的幂） */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error("FFT length must be a power of 2");

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
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** 汉宁窗（预计算） */
export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

/**
 * 单帧幅度谱（dB，已归一化到 [0,1]）
 * @returns 长度 fftSize/2 的能量密度（0=静默，1=满刻度）
 */
export function magnitudeFrame(
  samples: Float32Array,
  offset: number,
  fftSize: number,
  win: Float32Array,
  re: Float32Array,
  im: Float32Array
): Float32Array {
  for (let i = 0; i < fftSize; i++) {
    const s = offset + i < samples.length ? samples[offset + i] : 0;
    re[i] = s * win[i];
    im[i] = 0;
  }
  fftInPlace(re, im);
  const half = fftSize >> 1;
  const out = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (fftSize / 4);
    const db = 20 * Math.log10(mag + 1e-9);
    // 动态范围 -60dB..-5dB → 0..1
    const v = (db + 60) / 55;
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}
