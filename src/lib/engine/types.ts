/**
 * 声盾 ShieldEar 引擎 — 类型定义
 */

export const ENGINE_NAME = "ShieldEar";
export const ENGINE_VERSION = "v1.3.0-calibrated";

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
  /** 窄带（电话信道）判定：高频能量占比阈值 */
  narrowbandHfRatio: 0.015,
} as const;

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
