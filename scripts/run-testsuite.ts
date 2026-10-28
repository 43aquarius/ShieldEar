/**
 * 声盾系统测试套件 — 全量自动化评测（测试报告数据源）
 *
 * 测试分组（每组均测宽带 + 300–3400Hz 电话窄带两种信道）：
 *   N1 自然人声-原始（MDN/wavesurfer 公开人声 + 公有领域有声书）   预期：放行（LOW/MEDIUM）
 *   N2 自然人声-鲁棒性变体（±6dB 增益 / 1.05 变速 / 20dB 加噪）     预期：放行（抗误报）
 *   T1 合成语音-校准集（z-ai TTS 7 音色 × 3 文本，用于权重拟合）    预期：检出（HIGH/CRITICAL）
 *   T2 合成语音-独立测试集（同 7 音色 × 3 条新文本，文本级不相交）   预期：检出（泛化能力）
 *   T3 合成语音-退化鲁棒性变体（20dB 加噪 / MP3 编解码 / 1.05 变速） 预期：检出（召回鲁棒性）
 *
 * 附加微基准：单窗（2s）分析时延统计，支撑"判决时延≤1s"指标。
 *
 * 输出：calibration/testsuite_results.json（供测试报告与图表生成使用）
 */
import fs from 'fs';
import path from 'path';
import { decodeWav, mixToMono } from '../src/lib/audio/wav';
import { resampleTo16k } from '../src/lib/engine/dsp';
import { analyzeBuffer, analyzeWindow } from '../src/lib/engine/engine';
import { ENGINE_NAME, ENGINE_VERSION, ENGINE_PARAMS, SCORE_THRESHOLDS } from '../src/lib/engine/types';

const DIR = path.join(process.cwd(), 'calibration');
const ADIR = path.join(DIR, 'audio');
const SR = 16000;

interface Item {
  id: string;
  group: 'N1' | 'N2' | 'T1' | 'T2' | 'T3';
  name: string;
  cls: 'natural' | 'tts';
  channel: 'wideband' | 'narrowband';
  durationSec: number;
  analysisMs: number;
  rtf: number;
  syntheticRatio: number;
  risk: string;
  voicedWindows: number;
  expected: 'pass' | 'detect';
  result: 'pass' | 'detect' | 'miss' | 'false-alarm';
}

function loadPcm16k(file: string): Float32Array {
  const buf = fs.readFileSync(path.join(ADIR, file));
  const dec = decodeWav(new Uint8Array(buf).buffer);
  const mono = mixToMono(dec.pcm, dec.channels);
  return resampleTo16k(mono, dec.sampleRate);
}

/** 电话信道仿真：300–3400Hz 带通（FFT 域）+ 轻微底噪（与校准脚本一致） */
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

function judgeOne(
  id: string, group: Item['group'], name: string, cls: Item['cls'],
  channel: Item['channel'], pcm: Float32Array
): Item {
  const dur = pcm.length / SR;
  // JIT 预热后的稳定计时（外层计时，含特征提取+评分+汇总）
  const t0 = performance.now();
  const r = analyzeBuffer(pcm);
  const t1 = performance.now();
  const analysisMs = t1 - t0;
  const voiced = r.windows.filter((w) => w.voiced).length;
  const detected = r.overall.risk === 'HIGH' || r.overall.risk === 'CRITICAL';
  const passed = r.overall.risk === 'LOW' || r.overall.risk === 'MEDIUM';
  const expected = cls === 'tts' ? 'detect' : 'pass';
  const result: Item['result'] =
    expected === 'detect' ? (detected ? 'detect' : 'miss') : (passed ? 'pass' : 'false-alarm');
  return {
    id, group, name, cls, channel,
    durationSec: Math.round(dur * 100) / 100,
    analysisMs: Math.round(analysisMs * 100) / 100,
    rtf: Math.round((analysisMs / 1000 / dur) * 10000) / 10000,
    syntheticRatio: Math.round(r.overall.syntheticRatio * 1000) / 1000,
    risk: r.overall.risk,
    voicedWindows: voiced,
    expected, result,
  };
}

function pct(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx];
}

function metrics(items: Item[]) {
  const tp = items.filter((i) => i.cls === 'tts' && i.result === 'detect').length;
  const fn = items.filter((i) => i.cls === 'tts' && i.result === 'miss').length;
  const tn = items.filter((i) => i.cls === 'natural' && i.result === 'pass').length;
  const fp = items.filter((i) => i.cls === 'natural' && i.result === 'false-alarm').length;
  const total = tp + fn + tn + fp;
  const accuracy = total ? (tp + tn) / total : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    n: total, tp, fp, tn, fn,
    accuracy: Math.round(accuracy * 1000) / 1000,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
  };
}

function main() {
  // 预热 JIT
  {
    const warm = new Float32Array(SR * 4);
    for (let i = 0; i < warm.length; i++) warm[i] = 0.25 * Math.sin((2 * Math.PI * 220 * i) / SR);
    analyzeBuffer(warm);
    analyzeBuffer(warm);
  }

  const files = fs.readdirSync(ADIR);
  const naturals = files.filter((f) => /_16k\.wav$/.test(f)).sort();
  const variants = files.filter((f) => /^nvar_.*\.wav$/.test(f)).sort();
  const ttsCal = files.filter((f) => /^tts_.*\.wav$/.test(f)).sort();
  const ttsTest = files.filter((f) => /^tts2_.*\.wav$/.test(f)).sort();
  const ttsVar = files.filter((f) => /^tvar_.*\.wav$/.test(f)).sort();

  console.log(`sources: natural=${naturals.length} variants=${variants.length} ttsCal=${ttsCal.length} ttsTest=${ttsTest.length} ttsVar=${ttsVar.length}`);

  const items: Item[] = [];
  let seq = 0;
  const run = (group: Item['group'], list: string[], cls: Item['cls'], tag: string) => {
    for (const f of list) {
      const pcm = loadPcm16k(f);
      items.push(judgeOne(`TS-${String(++seq).padStart(3, '0')}`, group, `${tag}:${f}`, cls, 'wideband', pcm));
      items.push(judgeOne(`TS-${String(++seq).padStart(3, '0')}`, group, `${tag}-phone:${f}`, cls, 'narrowband', phoneChannel(pcm)));
      process.stdout.write('.');
    }
  };
  run('N1', naturals, 'natural', 'N');
  run('N2', variants, 'natural', 'NV');
  run('T1', ttsCal, 'tts', 'T');
  run('T2', ttsTest, 'tts', 'T2');
  run('T3', ttsVar, 'tts', 'TV');
  console.log(`\njudgments: ${items.length}`);

  // ── 单窗（2s）分析时延微基准：从全部源中取有能量的 2s 窗口 ──
  const winMs: number[] = [];
  const allSources = [...naturals, ...ttsCal, ...ttsTest, ...ttsVar];
  for (const f of allSources) {
    const pcm = loadPcm16k(f);
    for (let start = 0; start + SR * 2 <= pcm.length && winMs.length < 160; start += SR * 2) {
      // 取中段能量足够的窗口
      let e = 0;
      for (let i = start; i < start + SR * 2; i += 16) e += pcm[i] * pcm[i];
      if (Math.sqrt(e / (SR * 2 / 16)) < 0.01) continue;
      const t0 = performance.now();
      analyzeWindow(pcm, start, 0);
      winMs.push(performance.now() - t0);
    }
  }
  const winSorted = [...winMs].sort((a, b) => a - b);
  const microbench = {
    windows: winMs.length,
    meanMs: Math.round((winMs.reduce((s, v) => s + v, 0) / (winMs.length || 1)) * 100) / 100,
    p50Ms: Math.round(pct(winSorted, 0.5) * 100) / 100,
    p95Ms: Math.round(pct(winSorted, 0.95) * 100) / 100,
    p99Ms: Math.round(pct(winSorted, 0.99) * 100) / 100,
    maxMs: Math.round(pct(winSorted, 1) * 100) / 100,
  };

  // ── 汇总 ──
  const byChannel: Record<string, ReturnType<typeof metrics>> = {};
  for (const ch of ['wideband', 'narrowband'] as const) {
    byChannel[ch] = metrics(items.filter((i) => i.channel === ch));
  }
  const byGroup: Record<string, ReturnType<typeof metrics> & { label: string; available: boolean }> = {};
  const GROUP_LABEL: Record<string, string> = {
    N1: '自然人声-原始', N2: '自然人声-鲁棒性变体', T1: '合成语音-校准集', T2: '合成语音-独立测试集', T3: '合成语音-退化鲁棒性变体',
  };
  for (const g of ['N1', 'N2', 'T1', 'T2', 'T3'] as const) {
    const sel = items.filter((i) => i.group === g);
    byGroup[g] = { ...metrics(sel), label: GROUP_LABEL[g], available: sel.length > 0 };
  }
  // 分音色检出率（宽带+窄带合并，T1+T2）
  const byVoice: Record<string, { detected: number; total: number }> = {};
  for (const it of items.filter((i) => i.cls === 'tts')) {
    const m = it.name.match(/tts2?_([a-z]+)_/);
    if (!m) continue;
    const v = m[1];
    byVoice[v] = byVoice[v] || { detected: 0, total: 0 };
    byVoice[v].total++;
    if (it.result === 'detect') byVoice[v].detected++;
  }
  const rtfs = items.map((i) => i.rtf).sort((a, b) => a - b);
  const rtfStats = {
    min: Math.round(pct(rtfs, 0) * 10000) / 10000,
    mean: Math.round((rtfs.reduce((s, v) => s + v, 0) / (rtfs.length || 1)) * 10000) / 10000,
    p50: Math.round(pct(rtfs, 0.5) * 10000) / 10000,
    p95: Math.round(pct(rtfs, 0.95) * 10000) / 10000,
    max: Math.round(pct(rtfs, 1) * 10000) / 10000,
  };

  const out = {
    meta: {
      engine: `${ENGINE_NAME} ${ENGINE_VERSION}`,
      executedAt: new Date().toISOString(),
      runtime: `Node ${process.version} / bun ${typeof Bun !== 'undefined' ? Bun.version : 'n/a'}`,
      params: { ...ENGINE_PARAMS, thresholds: SCORE_THRESHOLDS },
      judgmentRule: 'TTS→HIGH/CRITICAL=检出(正确)；自然→LOW/MEDIUM=放行(正确)',
    },
    dataset: {
      naturalOriginal: naturals.length,
      naturalVariants: variants.length,
      ttsCalibration: ttsCal.length,
      ttsHoldout: ttsTest.length,
      ttsDegraded: ttsVar.length,
      channels: ['wideband', 'narrowband(300-3400Hz电话信道仿真)'],
    },
    items,
    microbench,
    summary: { byChannel, byGroup, byVoice, rtf: rtfStats, totalJudgments: items.length },
  };
  fs.writeFileSync(path.join(DIR, 'testsuite_results.json'), JSON.stringify(out, null, 2));
  console.log('\n== 汇总 ==');
  for (const ch of ['wideband', 'narrowband']) {
    const m = byChannel[ch];
    console.log(`[${ch}] TP=${m.tp} FP=${m.fp} TN=${m.tn} FN=${m.fn} | Acc=${m.accuracy} P=${m.precision} R=${m.recall} F1=${m.f1}`);
  }
  for (const g of Object.keys(byGroup)) {
    const m = byGroup[g];
    console.log(`[${g}] ${m.label}: n=${m.n} 正确=${m.tp + m.tn}${m.available ? '' : ' (不可用)'}`);
  }
  console.log('RTF:', JSON.stringify(rtfStats));
  console.log('单窗时延:', JSON.stringify(microbench));
  console.log('saved → calibration/testsuite_results.json');
}

main();
