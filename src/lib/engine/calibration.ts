/**
 * 声盾 ShieldEar 引擎 — 特征先验与评分校准
 *
 * 设计说明（诚实工程边界）：
 * - 本文件维护"自然人声统计先验"（μ、σ，按信道）与各特征权重；
 * - 先验与权重经真实样本离线拟合校准：自然类为 MDN / wavesurfer.js
 *   公开人声录音（含有声书），合成类为平台 TTS 引擎 7 音色输出，
 *   另构造 300–3400Hz 电话窄带退化集；
 * - 拟合方法：按信道取自然类先验 → z 标准化 → 类加权 L2 正则
 *   逻辑回归（natural×4 类权重），脚本 scripts/fit-weights.ts 可复现；
 * - 已知边界：录音棚级干净自然人声（如专业有声书）存在误判可能，
 *   该场景需 AASIST / RawGAT-ST 深度模型集成（见技术报告第 4 章）；
 * - 该引擎为"轻量可解释基线引擎"：所有判决可逐特征追溯，
 *   面向反诈取证的可解释性优先于黑盒精度。
 */

import type { ChannelType, RawFeatures } from "./types";
import { sigmoid, clamp } from "./dsp";

export interface FeatureMeta {
  key: keyof Omit<RawFeatures, "voicedRatio">;
  name: string;
  unit: string;
  description: string;
}

/** 特征元信息（用于可解释展示） */
export const FEATURE_META: FeatureMeta[] = [
  {
    key: "hfFlatness",
    name: "高频谱平坦度",
    unit: "",
    description:
      "4–8kHz 频段频谱的几何/算术均值比。神经声码器高频段常呈噪声填充或过度平滑结构，谱平坦度偏离自然发声的谐波-气流混合形态。",
  },
  {
    key: "hfEnergyRatio",
    name: "高频能量占比",
    unit: "",
    description:
      "3.25kHz 以上能量占总能量的比例。基于梅尔谱的合成器在高频段的能量分布与自然人声的摩擦音/气流分布存在系统性差异。",
  },
  {
    key: "hnr",
    name: "谐波规整度",
    unit: "",
    description:
      "归一化自相关峰值（谐波噪声比代理）。自然人声的谐波纯度随发声生理动态起伏，合成语音常表现为异常规整。",
  },
  {
    key: "hnrCV",
    name: "嗓音动力波动",
    unit: "",
    description:
      "谐波规整度的帧间变异。反映语句重音、气息带来的嗓音动力变化模式。",
  },
  {
    key: "fluxCV",
    name: "谱通量波动度",
    unit: "",
    description:
      "帧间谱变化的变异系数。神经声码器逐帧生成的波形在帧边界存在微观不连续，其谱通量波动模式与自然语流不同。",
  },
  {
    key: "jitter",
    name: "基音微扰",
    unit: "",
    description:
      "相邻浊音帧基音周期的相对扰动。自然声带存在生理性抖动，声码器输出的周期稳定度偏离自然区间。",
  },
  {
    key: "zcrCV",
    name: "过零率波动度",
    unit: "",
    description:
      "过零率的变异系数，反映频谱平衡的帧间稳定性。自然语流的辅音元音交替产生高波动，合成语音趋于稳定。",
  },
  {
    key: "hfPeriodicity",
    name: "高频周期性",
    unit: "",
    description:
      "高频段（4–8kHz）信号在基音周期处的自相关。自然语音高频以气息噪声为主，声码器会把谐波结构延展到高频段。",
  },
];

/**
 * 自然人声先验 — 宽带（16kHz 直采/宽带麦克风）
 * 拟合自自然类样本均值/标准差
 */
export const NATURAL_PRIORS_WB = {
  hfFlatness: { mu: 0.6688, sigma: 0.1055 },
  hfEnergyRatio: { mu: 0.144, sigma: 0.0948 },
  hnr: { mu: 0.523, sigma: 0.1047 },
  hnrCV: { mu: 0.1651, sigma: 0.0115 },
  fluxCV: { mu: 0.4801, sigma: 0.2707 },
  jitter: { mu: 0.0626, sigma: 0.0234 },
  zcrCV: { mu: 0.6114, sigma: 0.379 },
  hfPeriodicity: { mu: 0.1367, sigma: 0.0786 },
} as const;

/**
 * 自然人声先验 — 窄带（电话 300–3400Hz 信道）
 */
export const NATURAL_PRIORS_NB = {
  hfFlatness: { mu: 0.848, sigma: 0.002 },
  hfEnergyRatio: { mu: 0.1044, sigma: 0.0305 },
  hnr: { mu: 0.565, sigma: 0.0689 },
  hnrCV: { mu: 0.1929, sigma: 0.0311 },
  fluxCV: { mu: 0.5433, sigma: 0.2228 },
  jitter: { mu: 0.0614, sigma: 0.0271 },
  zcrCV: { mu: 0.3302, sigma: 0.1821 },
  hfPeriodicity: { mu: 0.064, sigma: 0.005 },
} as const;

/**
 * 评分权重 — 宽带（z 加权和 → logistic）
 * 拟合自类加权 L2 逻辑回归；权重为正表示该特征升高偏向"合成"
 */
export const WEIGHTS_WIDEBAND = {
  bias: -1.289,
  hfFlatness: 0.177,
  hfEnergyRatio: 0.368,
  hnr: 0.508,
  hnrCV: 0.317,
  fluxCV: 0.337,
  jitter: -0.037,
  zcrCV: 0.096,
  hfPeriodicity: 0.289,
} as const;

/**
 * 评分权重 — 窄带（高频特征失效，权重清零）
 */
export const WEIGHTS_NARROWBAND = {
  bias: -0.967,
  hfFlatness: 0,
  hfEnergyRatio: 0,
  hnr: 0.558,
  hnrCV: 0.074,
  fluxCV: 0.22,
  jitter: -0.085,
  zcrCV: 0.428,
  hfPeriodicity: 0,
} as const;

export type Weights = typeof WEIGHTS_WIDEBAND;
export type PriorMap = typeof NATURAL_PRIORS_WB;

export function naturalPriors(channel: ChannelType): PriorMap {
  return (channel === "narrowband" ? NATURAL_PRIORS_NB : NATURAL_PRIORS_WB) as PriorMap;
}

const Z_LIMIT = 3.0;
export const SCORE_KEYS = [
  "hfFlatness",
  "hfEnergyRatio",
  "hnr",
  "hnrCV",
  "fluxCV",
  "jitter",
  "zcrCV",
  "hfPeriodicity",
] as const;

/** 单特征 z 分数（相对同信道自然人声先验，限幅） */
export function featureZ(
  key: keyof RawFeatures,
  value: number,
  channel: ChannelType = "wideband"
): number {
  const p = naturalPriors(channel)[key as keyof PriorMap];
  if (!p) return 0;
  return clamp((value - p.mu) / p.sigma, -Z_LIMIT, Z_LIMIT);
}

/**
 * 窗口评分：特征 → z → 加权和 → logistic
 * 返回原始得分与各特征贡献（可解释输出）
 */
export function scoreWindow(
  f: RawFeatures,
  narrow: boolean
): {
  score: number;
  contributions: Record<string, number>;
  z: Record<string, number>;
} {
  const w: Weights = narrow ? WEIGHTS_NARROWBAND : WEIGHTS_WIDEBAND;
  const channel: ChannelType = narrow ? "narrowband" : "wideband";
  let sum = w.bias;
  const contributions: Record<string, number> = {};
  const z: Record<string, number> = {};
  for (const k of SCORE_KEYS) {
    const zk = featureZ(k, f[k], channel);
    const wk = w[k as keyof Weights];
    z[k] = zk;
    contributions[k] = zk * wk;
    sum += zk * wk;
  }
  return { score: sigmoid(sum), contributions, z };
}
