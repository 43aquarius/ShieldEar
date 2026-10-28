/**
 * 声盾校准 — 特征提取与评测
 * dump: 提取每文件特征 → calibration/features.json（与当前权重解耦）
 * eval: 用当前 calibration.ts 权重评估判决质量
 */
import fs from 'fs';
import path from 'path';
import { decodeWav, mixToMono } from '../src/lib/audio/wav';
import { resampleTo16k } from '../src/lib/engine/dsp';
import { analyzeBuffer } from '../src/lib/engine/engine';

const DIR = path.join(process.cwd(), 'calibration');
const ADIR = path.join(DIR, 'audio');

interface FileFeat {
  name: string;
  cls: 'natural' | 'tts';
  channel: 'wideband' | 'narrowband';
  feats: Record<string, number>;
  voicedWindows: number;
}

function loadPcm16k(file: string): Float32Array {
  const buf = fs.readFileSync(path.join(ADIR, file));
  const dec = decodeWav(new Uint8Array(buf).buffer);
  const mono = mixToMono(dec.pcm, dec.channels);
  return resampleTo16k(mono, dec.sampleRate);
}

/** 电话信道仿真：300–3400Hz 带通（FFT 域）+ 轻微底噪 */
function phoneChannel(pcm: Float32Array): Float32Array {
  const n = pcm.length;
  const B = 4096;
  const processed = new Float32Array(n);
  for (let start = 0; start + B <= n; start += B) {
    const reB = new Float64Array(B);
    const imB = new Float64Array(B);
    for (let i = 0; i < B; i++) reB[i] = pcm[start + i];
    fftSimple(reB, imB);
    const binHz = 16000 / B;
    const lo = Math.floor(300 / binHz);
    const hi = Math.ceil(3400 / binHz);
    for (let k = 0; k < B; k++) {
      const keep = (k >= lo && k <= hi) || (k >= B - hi && k <= B - lo);
      if (!keep) { reB[k] = 0; imB[k] = 0; }
    }
    ifftSimple(reB, imB);
    for (let i = 0; i < B; i++) processed[start + i] = (reB[i] / B) * 2;
  }
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x3fffffff - 1;
  };
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
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fftSimple(re, im);
  for (let i = 0; i < n; i++) im[i] = -im[i];
}

function extractFeats(name: string, cls: 'natural' | 'tts', pcm: Float32Array, channel: 'wideband' | 'narrowband'): FileFeat {
  const res = analyzeBuffer(pcm);
  const voiced = res.windows.filter((w) => w.voiced);
  const feats: Record<string, number> = {};
  for (const k of ['hfFlatness', 'hfEnergyRatio', 'hnr', 'hnrCV', 'fluxCV', 'jitter', 'zcrCV', 'hfPeriodicity']) {
    feats[k] = voiced.length
      ? voiced.reduce((s, w) => s + (w.features as any)[k], 0) / voiced.length
      : 0;
  }
  return { name, cls, channel, feats, voicedWindows: voiced.length };
}

function dump() {
  const out: FileFeat[] = [];
  const naturals = fs.readdirSync(ADIR).filter((f) => /_16k\.wav$/.test(f));
  const tts = fs.readdirSync(ADIR).filter((f) => /^tts_.*\.wav$/.test(f));
  for (const f of naturals) {
    const pcm = loadPcm16k(f);
    out.push(extractFeats(`N:${f}`, 'natural', pcm, 'wideband'));
    out.push(extractFeats(`N-phone:${f}`, 'natural', phoneChannel(pcm), 'narrowband'));
  }
  for (const f of tts) {
    const pcm = loadPcm16k(f);
    out.push(extractFeats(`T:${f}`, 'tts', pcm, 'wideband'));
    out.push(extractFeats(`T-phone:${f}`, 'tts', phoneChannel(pcm), 'narrowband'));
  }
  fs.writeFileSync(path.join(DIR, 'features.json'), JSON.stringify(out, null, 2));
  console.log(`dumped ${out.length} feature records → calibration/features.json`);
  // 快速打印类间分布
  for (const channel of ['wideband', 'narrowband'] as const) {
    console.log(`\n== ${channel} ==`);
    for (const k of ['hfFlatness', 'hfEnergyRatio', 'hnr', 'hnrCV', 'fluxCV', 'jitter', 'zcrCV', 'hfPeriodicity']) {
      const nat = out.filter((r) => r.cls === 'natural' && r.channel === channel).map((r) => r.feats[k]);
      const syn = out.filter((r) => r.cls === 'tts' && r.channel === channel).map((r) => r.feats[k]);
      if (!nat.length || !syn.length) continue;
      const mu = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
      const sd = (xs: number[]) => Math.sqrt(xs.reduce((s, v) => s + (v - mu(xs)) ** 2, 0) / Math.max(1, xs.length - 1));
      const pooled = Math.sqrt((sd(nat) ** 2 + sd(syn) ** 2) / 2) || 1e-9;
      console.log(
        k.padEnd(15),
        `nat=${mu(nat).toFixed(3)}±${sd(nat).toFixed(3)}`.padEnd(22),
        `tts=${mu(syn).toFixed(3)}±${sd(syn).toFixed(3)}`.padEnd(22),
        `sep=${(Math.abs(mu(syn) - mu(nat)) / pooled).toFixed(2)}`
      );
    }
  }
}

function evaluate() {
  const res: { name: string; cls: string; ratio: number; risk: string }[] = [];
  const naturals = fs.readdirSync(ADIR).filter((f) => /_16k\.wav$/.test(f));
  const tts = fs.readdirSync(ADIR).filter((f) => /^tts_.*\.wav$/.test(f));
  for (const f of naturals) {
    const pcm = loadPcm16k(f);
    for (const [tag, p] of [['wide', pcm], ['phone', phoneChannel(pcm)]] as const) {
      const r = analyzeBuffer(p);
      res.push({ name: `N-${tag}:${f}`, cls: 'natural', ratio: r.overall.syntheticRatio, risk: r.overall.risk });
    }
  }
  for (const f of tts) {
    const pcm = loadPcm16k(f);
    for (const [tag, p] of [['wide', pcm], ['phone', phoneChannel(pcm)]] as const) {
      const r = analyzeBuffer(p);
      res.push({ name: `T-${tag}:${f}`, cls: 'tts', ratio: r.overall.syntheticRatio, risk: r.overall.risk });
    }
  }
  console.log('name'.padEnd(36), 'ratio'.padStart(7), 'risk');
  for (const r of res) console.log(r.name.padEnd(36), r.ratio.toFixed(3).padStart(7), r.risk.padEnd(9));
  for (const tag of ['wide', 'phone']) {
    const sel = res.filter((r) => r.name.startsWith(`N-${tag}`) || r.name.startsWith(`T-${tag}`));
    const tp = sel.filter((r) => r.cls === 'tts' && ['HIGH', 'CRITICAL'].includes(r.risk)).length;
    const t = sel.filter((r) => r.cls === 'tts').length;
    const fn = sel.filter((r) => r.cls === 'natural' && ['LOW', 'MEDIUM'].includes(r.risk)).length;
    const n = sel.filter((r) => r.cls === 'natural').length;
    console.log(`\n[${tag}] TTS→合成 ${tp}/${t} | 自然→正常 ${fn}/${n}`);
  }
}

const mode = process.argv[2] ?? 'dump';
if (mode === 'dump') dump();
else evaluate();
