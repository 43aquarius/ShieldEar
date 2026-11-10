/**
 * 探针：v2.0 新特征候选形态的类间分离度对比（一次性调参工具，不入交付链）
 * 对校准集全部音频逐帧计算候选统计量，按窗口聚合后打印自然/合成分离度
 */
import fs from 'fs';
import path from 'path';
import { decodeWav, mixToMono } from '../src/lib/audio/wav';
import { resampleTo16k, getHann, fftInPlace, rms as rmsOf, autocorrPeak } from '../src/lib/engine/dsp';

const ADIR = path.join(process.cwd(), 'calibration', 'audio');
const SR = 16000, WIN = 32000, HOP = 16000, FRAME = 400, FRAME_HOP = 240, FFT = 512;
const BINS = (FFT >> 1) + 1, BIN_HZ = SR / FFT;

function loadPcm16k(file: string): Float32Array {
  const buf = fs.readFileSync(path.join(ADIR, file));
  const dec = decodeWav(new Uint8Array(buf).buffer);
  const mono = mixToMono(dec.pcm, dec.channels);
  return resampleTo16k(mono, dec.sampleRate);
}

function phoneChannel(pcm: Float32Array): Float32Array {
  const n = pcm.length, B = 4096, out = new Float32Array(n);
  const reB = new Float64Array(B), imB = new Float64Array(B);
  for (let start = 0; start + B <= n; start += B) {
    reB.fill(0); imB.fill(0);
    for (let i = 0; i < B; i++) reB[i] = pcm[start + i];
    fftInPlace(reB, imB);
    const lo = Math.floor(300 / (SR / B)), hi = Math.ceil(3400 / (SR / B));
    for (let k = 0; k < B; k++) {
      const keep = (k >= lo && k <= hi) || (k >= B - hi && k <= B - lo);
      if (!keep) { reB[k] = 0; imB[k] = 0; }
    }
    for (let i = 0; i < B; i++) imB[i] = -imB[i];
    fftInPlace(reB, imB);
    for (let i = 0; i < B; i++) out[start + i] = (reB[i] / B) * 2;
  }
  return out;
}

/** 每文件：逐帧候选统计 → 窗口内均值 → 文件均值（模拟引擎管线） */
function candidates(pcm: Float32Array) {
  const counts: Record<string, number[]> = {};
  const push = (k: string, v: number) => { (counts[k] ||= []).push(v); };
  const hann = getHann(FRAME);
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
  const sd = (xs: number[]) => Math.sqrt(xs.reduce((s, v) => s + (v - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1));
  const windowAgg: Record<string, number[]> = {};
  // 包络调制（S2）：窗口级统计 —— 幅度包络的 4–8Hz 能量占比
  function envMod(pcmW: Float32Array): number {
    const N = 320, envN = Math.floor(pcmW.length / N); // 20ms 子帧包络
    if (envN < 8) return 0;
    const env = new Float64Array(envN);
    for (let i = 0; i < envN; i++) {
      let s = 0;
      for (let j = 0; j < N; j++) s += pcmW[i * N + j] * pcmW[i * N + j];
      env[i] = Math.sqrt(s / N);
    }
    const m = mean([...env]);
    for (let i = 0; i < envN; i++) env[i] -= m;
    // 50 点实 DFT：envN*20ms 窗，分辨率 1/(envN*0.02) Hz
    const re = new Float64Array(FFT2), im = new Float64Array(FFT2);
    for (let i = 0; i < Math.min(envN, FFT2); i++) re[i] = env[i];
    fftInPlace(re, im);
    const binHz = 1 / (FFT2 * 0.02);
    let lo = Math.ceil(4 / binHz), hi = Math.floor(8 / binHz), s45 = 0, tot = 0;
    for (let k = 1; k < FFT2 / 2; k++) {
      const p = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      tot += p;
      if (k >= lo && k <= hi) s45 += p;
    }
    return tot > 1e-12 ? s45 / tot : 0;
  }
  const FFT2 = 512;

  for (let wStart = 0; wStart + WIN <= pcm.length; wStart += HOP) {
    for (const k of Object.keys(counts)) counts[k] = [];
    let prevLogMag: Float64Array | null = null;
    for (let fStart = wStart; fStart + FRAME <= wStart + WIN; fStart += FRAME_HOP) {
      const frame = pcm.subarray(fStart, fStart + FRAME);
      if (rmsOf(frame, 0, FRAME) <= 0.005) { prevLogMag = null; continue; }
      const re = new Float64Array(FFT), im = new Float64Array(FFT);
      for (let i = 0; i < FRAME; i++) re[i] = frame[i] * hann[i];
      fftInPlace(re, im);
      const mag = new Float64Array(BINS);
      for (let k = 0; k < BINS; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);

      // ---- 相位候选 ----
      const GD_LO = Math.floor(400 / BIN_HZ), HF_LO = Math.floor(4000 / BIN_HZ);
      let s1 = 0, s2 = 0, cnt = 0, hfSum = 0, lfSum = 0, big = 0;
      const taus: number[] = [];
      for (let k = GD_LO; k < BINS - 1; k++) {
        const m1 = mag[k], m2 = mag[k + 1];
        if (m1 < 1e-7 || m2 < 1e-7) continue;
        const dph = Math.atan2(im[k + 1], re[k + 1]) - Math.atan2(im[k], re[k]);
        const w = Math.pow(Math.sqrt(m1 * m2), 0.75);
        const t = Math.atan2(Math.sin(dph), Math.cos(dph)) * w;
        s1 += Math.abs(t); s2 += t * t; cnt++; taus.push(t);
        if (k >= HF_LO) hfSum += Math.abs(t); else lfSum += Math.abs(t);
        if (Math.abs(t) > 2.5 * w) big++;  // 近 π 跳变占比（|dph|>2.5rad）
      }
      if (cnt >= 8 && s1 > 1e-9) {
        push('P1_participation', (s1 * s1) / (cnt * s2));
        push('P2_hflf_ratio', hfSum / (lfSum + 1e-12));
        push('P3_cv', sd(taus) / (mean(taus.map(Math.abs)) + 1e-12));
        let lg = 0, ar = 0, m = 0;
        for (const t of taus) { lg += Math.log(Math.abs(t) + 1e-12); ar += Math.abs(t); m++; }
        push('P4_flatness', Math.exp(lg / m) / (ar / m + 1e-12));
        push('P5_bigfrac', big / cnt);
        push('P6_absmean', s1 / cnt); // 能量加权平均|GD|（含幅度尺度，用归一化谱？）
      }

      // ---- 嗓音质量/调制域候选 ----
      // S1 shimmer：相邻基音周期峰值幅度的相对扰动（需基音周期）
      {
        const decLen = Math.floor(FRAME / 2);
        const dec = new Float32Array(decLen);
        for (let i = 0; i < decLen; i++) dec[i] = (frame[i * 2] + frame[i * 2 + 1]) * 0.5;
        const rate = SR / 2;
        const pk = autocorrPeak(dec, 0, decLen, Math.max(8, Math.round(rate / 400)), Math.round(rate / 60));
        if (pk.value > 0.35 && pk.refined > 0) {
          const period = Math.round(pk.refined);
          const nP = Math.floor(decLen / period);
          let sA = 0, nA = 0, prevA = -1;
          for (let pIdx = 0; pIdx < nP; pIdx++) {
            let amp = 0;
            for (let i = pIdx * period; i < (pIdx + 1) * period; i++) amp = Math.max(amp, Math.abs(dec[i]));
            if (prevA > 0 && prevA + amp > 1e-9) { sA += Math.abs(amp - prevA) / ((amp + prevA) / 2); nA++; }
            prevA = amp;
          }
          if (nA >= 2) push('S1_shimmer', sA / nA);
        }
      }

      // ---- 倒谱候选 ----
      const cre = new Float64Array(FFT), cim = new Float64Array(FFT);
      const logMag = new Float64Array(BINS);
      for (let k = 0; k < BINS; k++) {
        logMag[k] = Math.log(mag[k] + 1e-12);
        cre[k] = logMag[k];
        if (k > 0 && k < BINS - 1) cre[FFT - k] = logMag[k];
      }
      fftInPlace(cre, cim);
      let lo832 = 0, lo1664 = 0, all = 0, flat = 0;
      for (let q = 1; q <= 64; q++) {
        const c = Math.abs(cre[q]);
        all += c;
        if (q >= 8 && q <= 32) lo832 += c;
        if (q >= 16 && q <= 64) lo1664 += c;
      }
      if (all > 1e-9) {
        push('C1_q16_64', lo1664 / all);
        push('C2_q8_32', lo832 / all);
      }
      // 对数谱通量（帧间）
      if (prevLogMag) {
        let d = 0, e = 0;
        for (let k = 1; k < BINS; k++) { d += Math.abs(logMag[k] - prevLogMag[k]); e += Math.abs(logMag[k]); }
        if (e > 1e-9) push('C3_logflux', d / e);
      }
      prevLogMag = logMag;
    }
    // 窗口聚合（与引擎一致：窗内均值）
    for (const [k, vs] of Object.entries(counts)) {
      if (vs.length) (windowAgg[k] ||= []).push(mean(vs));
    }
    // S2 包络调制（窗口级）
    if (wStart + WIN <= pcm.length) {
      const w = pcm.subarray(wStart, wStart + WIN);
      let e = 0;
      for (let i = 0; i < w.length; i += 16) e += w[i] * w[i];
      if (Math.sqrt(e / (w.length / 16)) > 0.01) (windowAgg['S2_envmod45'] ||= []).push(envMod(w));
    }
  }
  const out: Record<string, number> = {};
  for (const [k, vs] of Object.entries(windowAgg)) out[k] = mean(vs);
  return out;
}

function main() {
  const files = fs.readdirSync(ADIR).filter((f) => /_16k\.wav$/.test(f)).sort();
  const tts = fs.readdirSync(ADIR).filter((f) => /^tts_.*\.wav$/.test(f)).sort();
  interface Row { name: string; cls: string; ch: string; cands: Record<string, number>; }
  const rows: Row[] = [];
  for (const f of files) {
    const pcm = loadPcm16k(f);
    rows.push({ name: f, cls: 'natural', ch: 'wideband', cands: candidates(pcm) });
    rows.push({ name: f, cls: 'natural', ch: 'narrowband', cands: candidates(phoneChannel(pcm)) });
  }
  for (const f of tts) {
    const pcm = loadPcm16k(f);
    rows.push({ name: f, cls: 'tts', ch: 'wideband', cands: candidates(pcm) });
    rows.push({ name: f, cls: 'tts', ch: 'narrowband', cands: candidates(phoneChannel(pcm)) });
  }
  const keys = Object.keys(rows[0].cands);
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
  const sd = (xs: number[]) => Math.sqrt(xs.reduce((s, v) => s + (v - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1));
  for (const ch of ['wideband', 'narrowband']) {
    console.log(`\n== ${ch} ==`);
    for (const k of keys) {
      const nat = rows.filter((r) => r.cls === 'natural' && r.ch === ch).map((r) => r.cands[k]).filter((v) => !isNaN(v));
      const syn = rows.filter((r) => r.cls === 'tts' && r.ch === ch).map((r) => r.cands[k]).filter((v) => !isNaN(v));
      if (!nat.length || !syn.length) continue;
      const pooled = Math.sqrt((sd(nat) ** 2 + sd(syn) ** 2) / 2) || 1e-9;
      console.log(
        k.padEnd(18),
        `nat=${mean(nat).toFixed(3)}±${sd(nat).toFixed(3)}`.padEnd(22),
        `tts=${mean(syn).toFixed(3)}±${sd(syn).toFixed(3)}`.padEnd(22),
        `sep=${(Math.abs(mean(syn) - mean(nat)) / pooled).toFixed(2)}`
      );
    }
  }
}
main();
