/**
 * 声盾校准 — 类加权 L2 逻辑回归拟合评分权重
 * 数据：calibration/features.json（dump 模式产出）
 * 先验：按信道分别取自然类均值/标准差（z 分数 = 偏离同信道自然人声的程度）
 * 拟合：梯度下降 + 类权重（natural 5 : tts 20 → natural ×4）+ L2 正则
 * 校验：样本内混淆矩阵 + 自然类留一（LOO）稳健性
 */
import fs from 'fs';
import path from 'path';

const DATA = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'calibration', 'features.json'), 'utf8')
) as {
  name: string;
  cls: 'natural' | 'tts';
  channel: 'wideband' | 'narrowband';
  feats: Record<string, number>;
  voicedWindows: number;
}[];

const WB_KEYS = ['hfFlatness', 'hfEnergyRatio', 'hnr', 'hnrCV', 'fluxCV', 'jitter', 'zcrCV', 'hfPeriodicity'] as const;
const NB_KEYS = ['hnr', 'hnrCV', 'fluxCV', 'jitter', 'zcrCV'] as const;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function stats(xs: number[]) {
  const mu = xs.reduce((s, v) => s + v, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, xs.length - 1));
  return { mu, sd: Math.max(sd, 1e-6) };
}

interface FitResult {
  bias: number;
  weights: Record<string, number>;
  priors: Record<string, { mu: number; sigma: number }>;
  accTts: number;
  accNat: number;
  details: { name: string; cls: string; p: number; hit: boolean }[];
}

function fit(channel: 'wideband' | 'narrowband', lambda = 0.4, iters = 4000, lr = 0.15, skip?: Set<number>): FitResult {
  const keys = channel === 'wideband' ? [...WB_KEYS] : [...NB_KEYS];
  const rows = DATA.filter((r) => r.channel === channel && r.voicedWindows >= 3);
  const kept = rows.map((r, i) => ({ r, i })).filter(({ i }) => !skip?.has(i));
  // 先验：自然类（按信道）
  const priors: Record<string, { mu: number; sigma: number }> = {};
  for (const k of keys) {
    const nat = kept.filter((x) => x.r.cls === 'natural').map((x) => x.r.feats[k]);
    // fallback：若自然样本被全部留出，用全量自然
    const source = nat.length ? nat : rows.filter((r) => r.cls === 'natural').map((r) => r.feats[k]);
    const s = stats(source);
    priors[k] = { mu: +s.mu.toFixed(4), sigma: +s.sd.toFixed(4) };
  }
  // 样本：z 特征 + 标签 + 类权重
  const X = kept.map(({ r }) => keys.map((k) => (r.feats[k] - priors[k].mu) / priors[k].sigma));
  const y = kept.map(({ r }) => (r.cls === 'tts' ? 1 : 0));
  const cw = kept.map(({ r }) => (r.cls === 'natural' ? 4.0 : 1.0)); // 类平衡
  const n = X.length;

  let w = keys.map(() => 0);
  let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = keys.map(() => 0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < keys.length; j++) z += w[j] * X[i][j];
      const p = sigmoid(z);
      const err = (p - y[i]) * cw[i];
      gb += err;
      for (let j = 0; j < keys.length; j++) gw[j] += err * X[i][j];
    }
    b -= (lr * gb) / n;
    for (let j = 0; j < keys.length; j++) {
      w[j] -= lr * (gw[j] / n + lambda * w[j]);
    }
  }

  const weights: Record<string, number> = {};
  keys.forEach((k, j) => (weights[k] = +w[j].toFixed(3)));
  const bias = +b.toFixed(3);

  const details = kept.map(({ r }, i) => {
    let z = bias;
    for (let j = 0; j < keys.length; j++) z += weights[keys[j]] * X[i][j];
    const p = sigmoid(z);
    const hit = r.cls === 'tts' ? p > 0.5 : p <= 0.5;
    return { name: r.name, cls: r.cls, p: +p.toFixed(3), hit };
  });
  const accTts = details.filter((d) => d.cls === 'tts' && d.hit).length;
  const totTts = details.filter((d) => d.cls === 'tts').length;
  const accNat = details.filter((d) => d.cls === 'natural' && d.hit).length;
  const totNat = details.filter((d) => d.cls === 'natural').length;

  return { bias, weights, priors, accTts, accNat, details };
}

console.log('================ 宽带拟合 ================');
const wb = fit('wideband');
console.log('priors:', JSON.stringify(wb.priors));
console.log('weights:', JSON.stringify(wb.weights), 'bias:', wb.bias);
console.log(`TTS 判合成 ${wb.accTts}/${wb.details.filter((d) => d.cls === 'tts').length} | 自然判正常 ${wb.accNat}/${wb.details.filter((d) => d.cls === 'natural').length}`);
for (const d of wb.details.filter((d) => !d.hit)) console.log('  MISS:', d.name, 'p=', d.p);

console.log('\n================ 窄带拟合 ================');
const nb = fit('narrowband');
console.log('priors:', JSON.stringify(nb.priors));
console.log('weights:', JSON.stringify(nb.weights), 'bias:', nb.bias);
console.log(`TTS 判合成 ${nb.accTts}/${nb.details.filter((d) => d.cls === 'tts').length} | 自然判正常 ${nb.accNat}/${nb.details.filter((d) => d.cls === 'natural').length}`);
for (const d of nb.details.filter((d) => !d.hit)) console.log('  MISS:', d.name, 'p=', d.p);

// 自然类 LOO 稳健性（宽带）
console.log('\n================ 宽带自然类 LOO ================');
const rowsWb = DATA.filter((r) => r.channel === 'wideband' && r.voicedWindows >= 3);
const natIdx = rowsWb.map((r, i) => (r.cls === 'natural' ? i : -1)).filter((i) => i >= 0);
for (const i of natIdx) {
  const loo = fit('wideband', 0.4, 4000, 0.15, new Set([i]));
  const target = rowsWb[i];
  const keys = [...WB_KEYS];
  let z = loo.bias;
  for (const k of keys) {
    const pr = loo.priors[k] ?? wb.priors[k];
    z += loo.weights[k] * ((target.feats[k] - pr.mu) / pr.sigma);
  }
  console.log(`${target.name}  LOO p=${sigmoid(z).toFixed(3)}  (in-sample ${wb.details.find((d) => d.name === target.name)?.p})`);
}

// 混合片段构造（natural+tts 拼接，模拟"通话中混入合成片段"）的分数走势
console.log('\n==== 建议落入 calibration.ts 的常量（可直接粘贴） ====');
console.log('// WIDEBAND');
console.log(`NATURAL_PRIORS = ${JSON.stringify(wb.priors, null, 0)}`);
console.log(`WEIGHTS_WIDEBAND = ${JSON.stringify({ bias: wb.bias, ...wb.weights })}`);
console.log('// NARROWBAND');
console.log(`NATURAL_PRIORS_NB = ${JSON.stringify(nb.priors)}`);
console.log(`WEIGHTS_NARROWBAND = ${JSON.stringify({ bias: nb.bias, ...nb.weights })}`);
