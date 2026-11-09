/**
 * 声盾 ShieldEar 引擎 — 类型定义
 */

export const ENGINE_NAME = "ShieldEar";
export const ENGINE_VERSION = "v2.1.0-robust";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type WindowLabel = "silent" | "natural" | "suspect" | "synthetic";
export type ChannelType = "wideband" | "narrowband";

/** 引擎标准分析参数 */
export const ENGINE_PARAMS = {
  sampleRate: 16000,
  windowSec: 2.0,   // 滑动窗口 2 秒
  hopSec: 1.0,      // 50% 重叠
  frameMs: 25,      // 帧长 25ms
  hopMs: 15,        // 帧移 15ms
  fftSize: 512,
  /** 静音判定的帧 RMS 阈值（线性值，约 -46dBFS） */
  frameActiveRms: 0.005,
  /** 窗口判为有效语音所需的最小活跃帧比例 */
  windowVoicedRatio: 0.22,
  /** 窄带（电话信道）判定：3.5kHz+ 功率占比阈值（v2.0 修复原 3.25kHz 幅度占比的泄漏缺陷） */
  narrowbandHfRatio: 0.015,
} as const;

/** 输入质量护栏阈值（v2.1 探针实证：scripts/probe-robustness.ts，11 种扰动 × 15 源）
 *
 *  实证依据（calibration/robustness_results.json）：
 *  - +0.05 直流偏置使自然人声误报翻倍（FP 1→2，均值 0.298→0.512）
 *    → v2.1 引擎侧帧级/窗口级去均值修复 + 本护栏提示；
 *  - 白噪 SNR≤20dB 使合成漏检翻倍（1/10→4/10）且底噪指纹 -40dB
 *    （clean -89dB / 电话仿真 -53dB 不触发）→ 漏检风险提示；
 *  - ×0.1 极低电平（峰值 -23~-28dB）判决崩塌（硬漏 3/10、信道误判 6/15）
 *    → 电平过低提示；
 *  - 硬削波平顶比：clean <0.001% vs 削波 0.03%~0.14% → 削波提示。
 */
export const QUALITY_THRESHOLDS = {
  /** 平顶比：|x| ≥ 0.98·peak 样本占比 ≥ 0.02% 判削波 */
  clippingRatio: 0.0002,
  /** 直流偏置绝对均值 ≥ 1% 满幅 */
  dcOffset: 0.01,
  /** 底噪（去均值后 20ms 子帧 RMS 的 5% 分位，dBFS）高于此值 → 底噪偏高 */
  noiseFloorDb: -42,
  /** 峰值低于此值（dBFS）→ 输入电平过低 */
  peakDb: -20,
  /** 平顶比统计的峰值下限（避免极小信号误统计） */
  minPeak: 0.05,
} as const;

export type QualityWarning = "clipping" | "dc-offset" | "noisy-floor" | "low-level";

/** 输入质量诊断（v2.1：不影响判决本身，但影响判决可靠性，取证报告随附） */
export interface AudioQuality {
  /** 平顶比（|x| ≥ 0.98·peak 样本占比） */
  clippingRatio: number;
  /** 直流偏置（样本均值） */
  dcOffset: number;
  /** 底噪估计（去均值后 20ms 子帧 RMS 的 5% 分位，dBFS） */
  noiseFloorDb: number;
  /** 峰值电平（dBFS） */
  peakDb: number;
  /** 触发的质量警示（空数组 = 输入质量正常） */
  warnings: QualityWarning[];
}

/** 质量警示的用户可读建议（引擎同构交付，浏览器/服务端/报告共用同一份文案） */
export const QUALITY_ADVICE: Record<QualityWarning, string> = {
  clipping:
    "信号存在削波（削峰），部分声学特征可能失真，建议降低录音增益后重新检测",
  "dc-offset":
    "检测到直流偏置（劣质声卡/链路常见），引擎已自动去均值补偿，如对结论存疑建议交叉核验",
  "noisy-floor":
    "环境底噪偏高（约相当于信噪比 ≤ 20dB），漏检风险上升，建议在安静环境重新录制检测",
  "low-level":
    "输入电平过低，有效语音窗不足，判决可靠性下降，建议提高音量后重新检测",
};

/** 四项质量实测的单行摘要：削波/直流偏置/底噪/峰值（与 QUALITY_THRESHOLDS 四项一一对应）。
 *  核验报告与结果面板共用，保证「结论可靠边界」的呈现口径全端一致。 */
export function formatQualityMetrics(q: AudioQuality): string {
  return (
    `削波 ${(q.clippingRatio * 100).toFixed(3)}% · ` +
    `直流偏置 ${(q.dcOffset * 100).toFixed(2)}% · ` +
    `底噪 ${q.noiseFloorDb.toFixed(0)}dBFS · ` +
    `峰值 ${q.peakDb.toFixed(1)}dBFS`
  );
}

/** 质量诊断完整摘要：实测四项 + （有警示时）用户可读建议。
 *  正常 → 「正常（削波 … · 直流偏置 … · 底噪 … · 峰值 …）」；
 *  警示 → 「削波 … ｜ 警示：<建议1>；<建议2>」。核验报告「录音质量」行专用。 */
export function formatQualitySummary(q: AudioQuality): string {
  const metrics = formatQualityMetrics(q);
  return q.warnings.length
    ? `${metrics} ｜ 警示：${q.warnings.map((w) => QUALITY_ADVICE[w]).join("；")}`
    : `正常（${metrics}）`;
}

export interface RawFeatures {
  /** 4-8kHz 高频段谱平坦度（几何均值/算术均值），越接近 1 越接近白噪声 */
  hfFlatness: number;
  /** 3.25kHz 以上能量占比 */
  hfEnergyRatio: number;
  /** 谐波结构规整度（归一化自相关峰值均值，HNR 代理） */
  hnr: number;
  /** 谐波规整度的帧间波动（自然嗓音的发声动力性） */
  hnrCV: number;
  /** 谱通量的变异系数（声码器帧边界不连续指纹） */
  fluxCV: number;
  /** 基音周期微扰（jitter 代理） */
  jitter: number;
  /** 过零率变异系数 */
  zcrCV: number;
  /** 高频段周期性（声码器谐波延展指纹） */
  hfPeriodicity: number;
  /** 基频韵律动态（窗内 F0 变异系数，v2.0 学术增强） */
  f0Std: number;
  /** 振幅微扰（相邻基音周期峰值幅度扰动，v2.0 学术增强） */
  shimmer: number;
  /** 包络调制占比（4–8Hz 音节律调制能量比，v2.0 学术增强） */
  envMod45: number;
  /** 活跃帧占比 */
  voicedRatio: number;
}

export interface WindowResult {
  index: number;
  startSec: number;
  endSec: number;
  /** 平滑前得分 */
  rawScore: number;
  /** 平滑后得分（0-1，越高越疑似合成） */
  score: number;
  label: WindowLabel;
  voiced: boolean;
  rmsDb: number;
  channel: ChannelType;
  features: RawFeatures;
}

export interface Segment {
  startSec: number;
  endSec: number;
  meanScore: number;
  peakScore: number;
  windows: number;
}

export interface FeatureProfileItem {
  key: keyof Pick<
    RawFeatures,
    | "hfFlatness"
    | "hfEnergyRatio"
    | "hnr"
    | "hnrCV"
    | "fluxCV"
    | "jitter"
    | "zcrCV"
    | "hfPeriodicity"
    | "f0Std"
    | "shimmer"
    | "envMod45"
  >;
  name: string;
  meanValue: number;
  naturalPrior: number;
  naturalRange: number;
  zMean: number;
  interpretation: string;
}

export interface AnalysisResult {
  engine: {
    name: string;
    version: string;
    windowSec: number;
    hopSec: number;
  };
  audio: {
    durationSec: number;
    sampleRate: number;
    totalWindows: number;
    voicedWindows: number;
    silentWindows: number;
  };
  overall: {
    risk: RiskLevel;
    /** 有效语音窗的能量加权平均得分 */
    syntheticRatio: number;
    meanScore: number;
    maxScore: number;
    suspectSegmentCount: number;
    verdict: string;
    advice: string;
  };
  windows: WindowResult[];
  segments: Segment[];
  featureProfile: FeatureProfileItem[];
  channel: ChannelType;
  /** 输入质量诊断（v2.1 起提供；历史存量案例无此字段，消费方需判空） */
  quality?: AudioQuality;
  stats: {
    rtf: number;
    analyzeMs: number;
  };
}

/** 平滑链（中值 + EMA）后用于标签的阈值 */
export const SCORE_THRESHOLDS = {
  synthetic: 0.72,
  suspect: 0.5,
  alert: 0.7,
  risk: { medium: 0.35, high: 0.55, critical: 0.75 },
} as const;
