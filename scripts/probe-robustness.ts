/**
 * 声盾引擎抗干扰鲁棒性探针（v1.3.15 前置实证 · 诚实工程）
 *
 * 目的：实证引擎判决对常见录音链路扰动的稳定性，为「输入质量护栏」提供数据支撑。
 * 扰动集（确定性 RNG，全程可复现）：
 *   clean        原始基线
 *   noise20/10/5/0  加性高斯白噪（目标 SNR 20/10/5/0 dB，0dB 即噪声与信号等功率）
 *   gainUp       +6dB 增益（ADC 削顶，模拟「录得太热」）
 *   gainDown     −6dB 增益（模拟「录得太轻」）
 *   gainVeryLow  ×0.1（−20dB，极低电平输入）
 *   clip50       ±0.5 硬削波（严重过载）
 *   dc50         +0.05 直流偏置（劣质声卡常见）
 *   phone        300–3400Hz 带通 + 轻底噪（电话信道仿真，与测试套件同款）
 *
 * 样本：5 条自然人声 + 10 条合成（tts_ 5 音色 + tts2_ 跨引擎 5 音色），取前 9s。
 * 指标：syntheticRatio / risk / 信道判定漂移；同时记录扰动的质量指纹
 *   （clipRatio / dcOffset / noiseFloorDb / peakDb）用于验证护栏阈值。
 *
 * 用法：bun scripts/probe-robustness.ts [扰动名...]（无参 = 全部；结果可续跑合并）
 * 输出：calibration/robustness_results.json + 汇总表（stdout）
 */
import fs from 'fs';
import path from 'path';
import { decodeWav, mixToMono } from '../src/lib/audio/wav';
import { resampleTo16k } from '../src/lib/engine/dsp';
import { analyzeBuffer } from '../src/lib/engine/engine';

const ADIR = path.join(process.cwd(), 'calibration', 'audio');
const OUT = path.join(process.cwd(), 'calibration', 'robustness_results.json');
const SR = 16000;
const TRIM_SEC = 9;

/** 抽样：5 自然 + 10 合成（跨引擎均衡） */
const FILES: Array<{ file: string; cls: 'natural' | 'tts' }> = [
  { file: 'ws_demo_16k.wav', cls: 'natural' },
  { file: 'ws_librivox_16k.wav', cls: 'natural' },
  { file: 'ws_audio_16k.wav', cls: 'natural' },
  { file: 'ws_mono_16k.wav', cls: 'natural' },
  { file: 'viper_16k.wav', cls: 'natural' },
  { file: 'tts_tongtong_0.wav', cls: 'tts' },
  { file: 'tts_luodo_0.wav', cls: 'tts' },
  { file: 'tts_kazi_0.wav', cls: 'tts' },
  { file: 'tts_douji_0.wav', cls: 'tts' },
  { file: 'tts_jam_0.wav', cls: 'tts' },
  { file: 'tts2_yunxi_1.wav', cls: 'tts' },
  { file: 'tts2_xiaoxiao_1.wav', cls: 'tts' },
  { file: 'tts2_yunjian_1.wav', cls: 'tts' },
  { file: 'tts2_xiaobei_1.wav', cls: 'tts' },
  { file: 'tts2_yunyang_1.wav', cls: 'tts' },
];

const PERTURBATIONS = [
  'clean', 'noise20', 'noise10', 'noise5', 'noise0',
  'gainUp', 'gainDown', 'gainVeryLow', 'clip50', 'dc50', 'phone',
] as const;
type Pert = (typeof PERTURBATIONS)[number];

function loadPcm(file: string): Float32Array {
  const buf = fs.readFileSync(path.join(ADIR, file));
  const dec = decodeWav(new Uint8Array(buf).buffer);
  const mono = mixToMono(dec.pcm, dec.channels);
  const pcm = resampleTo16k(mono, dec.sampleRate);
  return pcm.subarray(0, Math.min(pcm.length, TRIM_SEC * SR));
}

/** 确定性 LCG 噪声（与测试套件 phoneChannel 同款生成器） */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x3fffffff - 1;
  };
}

function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function power(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p += x[i] * x[i];
  return x.length ? p / x.length : 0;
}

function perturb(pcm: Float32Array, pert: Pert, file: string): Float32Array {
  const n = pcm.length;
  const out = new Float32Array(n);
  const rand = lcg(hashStr(file + '|' + pert));
  switch (pert) {
    case 'clean':
      return pcm;
    case 'noise20': case 'noise10': case 'noise5': case 'noise0': {
      const snrDb = { noise20: 20, noise10: 10, noise5: 5, noise0: 0 }[pert];
      const ps = power(pcm);
      const pn = ps / Math.pow(10, snrDb / 10);
      const amp = Math.sqrt(pn / (1 / 3)); // rand() 均匀[-1,1]，方差 1/3
      for (let i = 0; i < n; i++) out[i] = pcm[i] + rand() * amp;
      return out;
    }
    case 'gainUp':
      for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(-1, pcm[i] * 2));
      return out;
    case 'gainDown':
      for (let i = 0; i < n; i++) out[i] = pcm[i] * 0.5;
      return out;
    case 'gainVeryLow':
      for (let i = 0; i < n; i++) out[i] = pcm[i] * 0.1;
      return out;
    case 'clip50':
      for (let i = 0; i < n; i++) out[i] = Math.min(0.5, Math.max(-0.5, pcm[i]));
      return out;
    case 'dc50':
      for (let i = 0; i < n; i++) out[i] = pcm[i] + 0.05;
      return out;
    case 'phone':
      return phoneChannel(pcm, rand);
  }
}

/** 与测试套件一致的电话信道仿真：300–3400Hz 带通 + 轻底噪 */
function phoneChannel(pcm: Float32Array, rand: () => number): Float32Array {
  const n = pcm.length;
  const B = 4096;
  const processed = new Float32Array(n);
  for (let start = 0; start + B <= n; start += B) {
    const reB = new Float64Array(B);
    const imB = new Float64Array(B);
    for (let i = 0; i < B; i++) reB[i] = pcm[start + i];
    fftSimple(reB, imB);
    const binHz = SR / B;
    const lo = Math.floor(300 / binHz);
    const hi = Math.ceil(3400 / binHz);
    for (let k = 0; k < B; k++) {
      const keep = (k >= lo && k <= hi) || (k >= B - hi && k <= B - lo);
      if (!keep) { reB[k] = 0; imB[k] = 0; }
    }
    ifftSimple(reB, imB);
    for (let i = 0; i < B; i++) processed[start + i] = (reB[i] / B) * 2;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = processed[i] * 0.9 + rand() * 0.003;
  return out;
}

function fftSimple(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2], bi = im[i + k + len / 2];
        const vr = br * wr - bi * wi, vi = br * wi + bi * wr;
        re[i + k] = ar + vr; im[i + k] = ai + vi;
        re[i + k + len / 2] = ar - vr; im[i + k + len / 2] = ai - vi;
      }
    }
  }
}

function ifftSimple(re: Float64Array, im: Float64Array) {
  // 与测试套件原版一致：共轭-FFT-共轭，不除 n（缩放由调用方 /B*2 补偿）
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fftSimple(re, im);
  for (let i = 0; i < n; i++) im[i] = -im[i];
}

/** 质量指纹（拟入引擎护栏的四项，先在探针里验证区分力）
 *  clipRatio 采用「平顶比」：|x| ≥ 0.98·maxAbs 的样本占比——
 *  硬削波信号大量样本精确停在削波电平（±0.5 削波同样可检出，
 *  只盯 ±0.985 满幅会漏掉非满幅削波，v1 探针实测教训）。
 */
function qualityFingerprint(x: Float32Array) {
  let dc = 0, peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    dc += x[i];
  }
  let clip = 0;
  if (peak > 0.05) {
    const rail = 0.98 * peak;
    for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= rail) clip++;
  }
  // 20ms 子帧 RMS 的 5% 分位 → 底噪估计（dBFS）
  const SUB = Math.round(0.02 * SR);
  const subs: number[] = [];
  for (let s = 0; s + SUB <= x.length; s += SUB) {
    let p = 0;
    for (let i = 0; i < SUB; i++) p += x[s + i] * x[s + i];
    subs.push(Math.sqrt(p / SUB));
  }
  subs.sort((a, b) => a - b);
  const floorRms = subs.length ? subs[Math.floor(subs.length * 0.05)] : 0;
  return {
    clipRatio: clip / x.length,
    dcOffset: dc / x.length,
    noiseFloorDb: floorRms > 0 ? 20 * Math.log10(floorRms) : -120,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -120,
  };
}

interface Combo {
  file: string; cls: 'natural' | 'tts'; pert: Pert;
  ratio: number; risk: string; channel: string;
  clipRatio: number; dcOffset: number; noiseFloorDb: number; peakDb: number;
}

function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-')) as Pert[];
  const todo = requested.length ? requested : [...PERTURBATIONS];
  const known = new Set(PERTURBATIONS);
  for (const p of todo) if (!known.has(p)) { console.error(`未知扰动: ${p}`); process.exit(1); }

  let db: Record<string, Combo> = {};
  if (fs.existsSync(OUT)) {
    try { db = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { db = {}; }
  }

  const pcms = new Map<string, Float32Array>();
  for (const { file } of FILES) pcms.set(file, loadPcm(file));

  for (const pert of todo) {
    let did = 0;
    for (const { file, cls } of FILES) {
      const key = `${file}|${pert}`;
      if (db[key]) continue;
      const sig = perturb(pcms.get(file)!, pert, file);
      const res = analyzeBuffer(sig);
      const q = qualityFingerprint(sig);
      db[key] = {
        file, cls, pert,
        ratio: res.overall.syntheticRatio,
        risk: res.overall.risk,
        channel: res.channel,
        ...q,
      };
      did++;
    }
    fs.writeFileSync(OUT, JSON.stringify(db, null, 1));
    console.log(`[${pert}] 完成（新增 ${did}）`);
  }

  // ---- 汇总 ----
  console.log('\n== 扰动 × 判决稳定性（detect 线 = HIGH 0.55；natural FP = ≥HIGH）==');
  console.log('扰动        | 自然 mean/min/max        FP(HIGH+) FP(MED+) | 合成 mean/min    漏检(<HIGH) 硬漏(<MED) | 信道漂移');
  for (const pert of PERTURBATIONS) {
    const rows = FILES.map((f) => db[`${f.file}|${pert}`]).filter(Boolean);
    if (!rows.length) continue;
    const nat = rows.filter((r) => r.cls === 'natural');
    const tts = rows.filter((r) => r.cls === 'tts');
    const cleanRows = FILES.map((f) => db[`${f.file}|clean`]).filter(Boolean);
    const stat = (arr: number[]) =>
      `${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3)}/${Math.min(...arr).toFixed(3)}/${Math.max(...arr).toFixed(3)}`;
    const fpHigh = nat.filter((r) => r.ratio >= 0.55).length;
    const fpMed = nat.filter((r) => r.ratio >= 0.35).length;
    const missHigh = tts.filter((r) => r.ratio < 0.55).length;
    const missMed = tts.filter((r) => r.ratio < 0.35).length;
    const chFlip = rows.filter((r) => {
      const c = cleanRows.find((x) => x.file === r.file);
      return c && c.channel !== r.channel;
    }).length;
    console.log(
      `${pert.padEnd(11)} | ${stat(nat.map((r) => r.ratio)).padEnd(23)} ${String(fpHigh).padStart(5)}    ${String(fpMed).padStart(5)}   | ` +
      `${stat(tts.map((r) => r.ratio)).padEnd(17)} ${String(missHigh).padStart(4)}      ${String(missMed).padStart(4)}     | ${chFlip}`
    );
  }
  console.log('\n== 质量指纹（护栏阈值验证）==');
  console.log('扰动        | clipRatio(均值)   | dcOffset          | noiseFloorDb(均值) | peakDb(均值)');
  for (const pert of PERTURBATIONS) {
    const rows = FILES.map((f) => db[`${f.file}|${pert}`]).filter(Boolean);
    if (!rows.length) continue;
    const avg = (sel: (r: Combo) => number) =>
      (rows.reduce((a, r) => a + sel(r), 0) / rows.length).toFixed(4);
    console.log(
      `${pert.padEnd(11)} | ${avg((r) => r.clipRatio).padEnd(16)} | ${avg((r) => r.dcOffset).padEnd(17)} | ${avg((r) => r.noiseFloorDb).padEnd(18)} | ${avg((r) => r.peakDb)}`
    );
  }
}

main();
