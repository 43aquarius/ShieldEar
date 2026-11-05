/**
 * 声盾 ShieldEar 引擎 — 核心分析器
 * 滑动窗口流式检测：2s 窗口 / 1s 步进（50% 重叠），逐窗输出合成概率
 *
 * 同构设计：浏览器（实时鉴听）与 Node（服务端复核）运行完全相同的代码，
 * 保证"客户端初判 + 服务端复核"的判决一致性，满足反诈取证的可复现要求。
 *
 * 特征集（面向神经声码器指纹，数据驱动校准）：
 *  - hfFlatness      4–8kHz 谱平坦度
 *  - hfEnergyRatio   3.25kHz+ 能量占比
 *  - hnr             谐波规整度（自相关峰值均值）
 *  - hnrCV           谐波规整度的帧间波动（自然嗓音动力性）
 *  - fluxCV          谱通量变异系数（声码器帧边界不连续指纹）
 *  - jitter          基音周期微扰
 *  - zcrCV           过零率变异系数
 *  - hfPeriodicity   高频段周期性（声码器谐波延展指纹）
 */

import {
  getHann,
  fftInPlace,
  rms,
  toDb,
  autocorrPeak,
  median3,
  ema,
  mean,
  std,
  clamp,
} from "./dsp";
import { scoreWindow, FEATURE_META, naturalPriors, featureZ } from "./calibration";
import {
  ENGINE_NAME,
  ENGINE_VERSION,
  ENGINE_PARAMS,
  SCORE_THRESHOLDS,
  type AnalysisResult,
  type ChannelType,
  type FeatureProfileItem,
  type RawFeatures,
  type RiskLevel,
  type Segment,
  type WindowResult,
} from "./types";

const SR = ENGINE_PARAMS.sampleRate;
const WIN = Math.round(ENGINE_PARAMS.windowSec * SR); // 32000
const HOP = Math.round(ENGINE_PARAMS.hopSec * SR); // 16000
const FRAME = Math.round(ENGINE_PARAMS.frameMs * SR / 1000); // 400
const FRAME_HOP = Math.round(ENGINE_PARAMS.hopMs * SR / 1000); // 240
const FFT = ENGINE_PARAMS.fftSize; // 512
const BINS = (FFT >> 1) + 1;
const BIN_HZ = SR / FFT; // 31.25 Hz
/** 高频段：4kHz–8kHz */
const HF_LO = Math.floor(4000 / BIN_HZ);
const HF_HI = FFT >> 1;
/** 高频能量占比统计起点：3.25kHz */
const HF_EN_LO = Math.floor(3250 / BIN_HZ);
/** 基音分析：帧内 2:1 抽取到 8kHz 域 */
const DEC = 2;

function pitchLags(): { minLag: number; maxLag: number } {
  const rate = SR / DEC;
  return {
    minLag: Math.max(8, Math.round(rate / 400)),
    maxLag: Math.round(rate / 60),
  };
}

/**
 * 单窗特征提取 + 评分
 */
export function analyzeWindow(
  pcm: Float32Array,
  start: number,
  index: number,
  opts: { forcedChannel?: ChannelType } = {}
): WindowResult {
  const winLen = Math.min(WIN, pcm.length - start);
  const end = start + winLen;
  const startSec = start / SR;
  const endSec = end / SR;
  const winRms = rms(pcm, start, winLen);

  const nFrames = Math.max(0, Math.floor((winLen - FRAME) / FRAME_HOP) + 1);
  const activeRms: number[] = [];
  const hfFlatList: number[] = [];
  const hfRatioList: number[] = [];
  const fluxList: number[] = [];
  const zcrList: number[] = [];
  const hnrList: number[] = [];
  const periodList: number[] = [];
  const hfPeriodList: number[] = [];

  const { minLag, maxLag } = pitchLags();
  const hann = getHann(FRAME);
  let prevMag: Float64Array | null = null;

  for (let fi = 0; fi < nFrames; fi++) {
    const fStart = start + fi * FRAME_HOP;
    const frame = pcm.subarray(fStart, fStart + FRAME);
    const frms = rms(frame, 0, FRAME);
    if (frms <= ENGINE_PARAMS.frameActiveRms) {
      prevMag = null; // 跨静音不做 flux
      continue;
    }
    activeRms.push(frms);

    // ---- FFT（一次计算，复用幅度谱与相位） ----
    const re = new Float64Array(FFT);
    const im = new Float64Array(FFT);
    for (let i = 0; i < FRAME; i++) re[i] = frame[i] * hann[i];
    fftInPlace(re, im);
    const mag = new Float64Array(BINS);
    for (let k = 0; k < BINS; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);

    // 高频能量占比 & 谱平坦度
    let hfSum = 0, totalSum = 0, logSum = 0;
    for (let k = 1; k < BINS; k++) {
      totalSum += mag[k];
      if (k >= HF_LO) {
        hfSum += mag[k];
        logSum += Math.log(mag[k] + 1e-12);
      }
    }
    const hfCount = BINS - HF_LO;
    if (hfSum > 1e-9) {
      const arith = hfSum / hfCount;
      const geo = Math.exp(logSum / hfCount);
      hfFlatList.push(clamp(geo / (arith + 1e-12), 0, 1));
    }
    if (totalSum > 1e-9) {
      let hfEn = 0;
      for (let k = HF_EN_LO; k < BINS; k++) hfEn += mag[k];
      hfRatioList.push(hfEn / totalSum);
    }

    // 谱通量
    if (prevMag) {
      let d = 0, e = 0;
      for (let k = 1; k < BINS; k++) {
        d += Math.abs(mag[k] - prevMag[k]);
        e += mag[k];
      }
      if (e > 1e-9) fluxList.push(d / e);
    }
    prevMag = mag;

    // 过零率
    let zc = 0;
    for (let i = 1; i < frame.length; i++) {
      if ((frame[i - 1] >= 0 && frame[i] < 0) || (frame[i - 1] < 0 && frame[i] >= 0)) zc++;
    }
    zcrList.push(zc / frame.length);

    // ---- 基音分析（8kHz 抽取域） ----
    const decLen = Math.floor(FRAME / DEC);
    const dec = new Float32Array(decLen);
    for (let i = 0; i < decLen; i++) {
      dec[i] = (frame[i * DEC] + frame[i * DEC + 1]) * 0.5;
    }
    const peak = autocorrPeak(dec, 0, decLen, minLag, maxLag);
    if (peak.value > 0.35 && peak.refined > 0) {
      hnrList.push(peak.value);
      periodList.push(peak.refined);

      // ---- 高频段周期性：声码器把谐波结构延展到高频，自然语音高频以气息噪声为主 ----
      // 用掩蔽谱的 IFFT 取高频段时域信号，在基音周期处的归一化自相关
      const hre = new Float64Array(FFT);
      const him = new Float64Array(FFT);
      for (let k = HF_LO; k <= HF_HI; k++) {
        hre[k] = re[k]; him[k] = im[k];
        if (k < HF_HI && k > 0) { // 镜像 bin
          hre[FFT - k] = re[FFT - k];
          him[FFT - k] = im[FFT - k];
        }
      }
      // 逆 FFT（共轭对称 → 实信号）
      for (let i = 0; i < FFT; i++) him[i] = -him[i];
      fftInPlace(hre, him); // 正变换 + 取负虚部 = 逆变换
      let hs = 0, hc = 0;
      const lag16 = Math.max(2, Math.round(peak.refined * DEC));
      for (let i = 0; i + lag16 < FRAME; i++) {
        const a = hre[i] / FFT;
        const b = hre[i + lag16] / FFT;
        hs += a * a;
        hc += a * b;
      }
      if (hs > 1e-9) hfPeriodList.push(clamp(Math.abs(hc) / hs, 0, 1));
    }
  }

  const voicedRatio = nFrames > 0 ? activeRms.length / nFrames : 0;
  const voiced = voicedRatio >= ENGINE_PARAMS.windowVoicedRatio;

  // jitter：相邻浊音帧周期相对扰动
  const jitterList: number[] = [];
  for (let i = 1; i < periodList.length; i++) {
    const a = periodList[i - 1], b = periodList[i];
    if (Math.abs(a - b) / a < 0.5) jitterList.push(Math.abs(b - a) / a);
  }

  // 信道判定：高频能量占比极低 → 电话窄带信道
  const hfRatioMean = hfRatioList.length ? mean(hfRatioList) : 0;
  const channel: ChannelType =
    opts.forcedChannel ??
    (hfRatioMean < ENGINE_PARAMS.narrowbandHfRatio ? "narrowband" : "wideband");

  const features: RawFeatures = {
    hfFlatness: hfFlatList.length ? mean(hfFlatList) : 0,
    hfEnergyRatio: hfRatioMean,
    hnr: hnrList.length ? mean(hnrList) : 0,
    hnrCV: hnrList.length > 3 ? std(hnrList) / (mean(hnrList) + 1e-9) : 0,
    fluxCV: fluxList.length > 1 ? std(fluxList) / (mean(fluxList) + 1e-9) : 0,
    jitter: jitterList.length ? mean(jitterList) : 0,
    zcrCV: zcrList.length > 1 ? std(zcrList) / (mean(zcrList) + 1e-9) : 0,
    hfPeriodicity: hfPeriodList.length ? mean(hfPeriodList) : 0,
    voicedRatio,
  };

  let rawScore = 0;
  if (voiced) {
    const { score } = scoreWindow(features, channel === "narrowband");
    rawScore = score;
  }

  return {
    index,
    startSec,
    endSec,
    rawScore,
    score: rawScore,
    label: voiced ? "natural" : "silent",
    voiced,
    rmsDb: toDb(winRms),
    channel,
    features,
  };
}

/** 对整段 rawScore 序列做平滑（中值 + EMA）并打标签 */
function smoothAndLabel(windows: WindowResult[]): void {
  const voicedIdx = windows
    .map((w, i) => (w.voiced ? i : -1))
    .filter((i) => i >= 0);
  const raws = voicedIdx.map((i) => windows[i].rawScore);
  const med = median3(raws);
  const smoothed = ema(med, 0.35);
  voicedIdx.forEach((wi, j) => {
    windows[wi].score = smoothed[j];
    windows[wi].label =
      smoothed[j] >= SCORE_THRESHOLDS.synthetic
        ? "synthetic"
        : smoothed[j] >= SCORE_THRESHOLDS.suspect
          ? "suspect"
          : "natural";
  });
}

/** 聚合可疑片段（连续 suspect/synthetic 窗合并） */
function extractSegments(windows: WindowResult[]): Segment[] {
  const segs: Segment[] = [];
  let cur: WindowResult[] = [];
  const flush = () => {
    if (cur.length) {
      segs.push({
        startSec: cur[0].startSec,
        endSec: cur[cur.length - 1].endSec,
        meanScore: mean(cur.map((w) => w.score)),
        peakScore: Math.max(...cur.map((w) => w.score)),
        windows: cur.length,
      });
      cur = [];
    }
  };
  for (const w of windows) {
    if (w.voiced && w.score >= SCORE_THRESHOLDS.suspect) cur.push(w);
    else flush();
  }
  flush();
  return segs;
}

function riskOf(ratio: number): RiskLevel {
  if (ratio >= SCORE_THRESHOLDS.risk.critical) return "CRITICAL";
  if (ratio >= SCORE_THRESHOLDS.risk.high) return "HIGH";
  if (ratio >= SCORE_THRESHOLDS.risk.medium) return "MEDIUM";
  return "LOW";
}

const VERDICTS: Record<RiskLevel, { verdict: string; advice: string }> = {
  CRITICAL: {
    verdict: "高度疑似 AI 合成语音",
    advice:
      "多个声学特征维度显著偏离自然人声统计规律。强烈建议立即中止转账、汇款、透露验证码等敏感操作，通过已知可信号码回拨核实对方身份，并保留本报告向 96110 反诈专线举报。",
  },
  HIGH: {
    verdict: "疑似 AI 合成语音",
    advice:
      "检测到持续性声学特征异常。建议不要仅凭该通话作出资金或信息决策，改用视频见面、回拨核实等多渠道交叉验证身份。",
  },
  MEDIUM: {
    verdict: "存在可疑片段",
    advice:
      "部分时段特征异常，可信度不足以定性。建议提高警惕，对涉及资金、隐私的关键内容进行二次核验。",
  },
  LOW: {
    verdict: "未发现明显合成特征",
    advice:
      "声学特征与自然人声统计规律相符。请注意：本结论仅为辅助参考，不构成对说话人真实身份的保证。",
  },
};

function buildFeatureProfile(
  windows: WindowResult[],
  channel: ChannelType
): FeatureProfileItem[] {
  const voiced = windows.filter((w) => w.voiced);
  return FEATURE_META.map((meta) => {
    const vals = voiced.map((w) => w.features[meta.key]);
    const m = vals.length ? mean(vals) : 0;
    const p = naturalPriors(channel)[meta.key as keyof ReturnType<typeof naturalPriors>];
    return {
      key: meta.key,
      name: meta.name,
      meanValue: m,
      naturalPrior: p.mu,
      naturalRange: p.sigma,
      zMean: featureZ(meta.key, m, channel),
      interpretation: meta.description,
    };
  });
}

/** 计算整体结论（供整段分析与流式中间态共用） */
export function summarize(
  windows: WindowResult[],
  durationSec: number,
  analyzeMs: number
): AnalysisResult {
  smoothAndLabel(windows);
  const voiced = windows.filter((w) => w.voiced);
  const silent = windows.length - voiced.length;

  // 能量加权平均得分（权重 = 10^(dB/20)）
  let wSum = 0, sSum = 0;
  for (const w of voiced) {
    const weight = Math.pow(10, w.rmsDb / 20);
    wSum += weight;
    sSum += weight * w.score;
  }
  const ratio = wSum > 0 ? sSum / wSum : 0;
  const risk: RiskLevel = voiced.length === 0 ? "LOW" : riskOf(ratio);
  const segments = extractSegments(windows);
  const channel: ChannelType =
    voiced.filter((w) => w.channel === "narrowband").length >
    voiced.length / 2
      ? "narrowband"
      : "wideband";

  return {
    engine: {
      name: ENGINE_NAME,
      version: ENGINE_VERSION,
      windowSec: ENGINE_PARAMS.windowSec,
      hopSec: ENGINE_PARAMS.hopSec,
    },
    audio: {
      durationSec,
      sampleRate: SR,
      totalWindows: windows.length,
      voicedWindows: voiced.length,
      silentWindows: silent,
    },
    overall: {
      risk,
      syntheticRatio: ratio,
      meanScore: voiced.length ? mean(voiced.map((w) => w.score)) : 0,
      maxScore: voiced.length ? Math.max(...voiced.map((w) => w.score)) : 0,
      suspectSegmentCount: segments.length,
      ...VERDICTS[risk],
    },
    windows,
    segments,
    featureProfile: buildFeatureProfile(windows, channel),
    channel,
    stats: {
      rtf: durationSec > 0 ? analyzeMs / 1000 / durationSec : 0,
      analyzeMs,
    },
  };
}

/**
 * 整段分析（文件 / 服务端复核）
 */
export function analyzeBuffer(pcm: Float32Array): AnalysisResult {
  const t0 = nowMs();
  const windows: WindowResult[] = [];
  if (pcm.length >= FRAME * 4) {
    const count = Math.max(1, Math.ceil((pcm.length - WIN) / HOP) + 1);
    for (let i = 0; i < count; i++) {
      const start = i * HOP;
      if (start + FRAME * 4 > pcm.length) break;
      windows.push(analyzeWindow(pcm, start, i));
    }
  }
  const t1 = nowMs();
  return summarize(windows, pcm.length / SR, t1 - t0);
}

/**
 * 流式分析器（实时鉴听）
 * push() 持续喂入 PCM；poll() 取出新完成的窗口；finalize() 产出完整报告
 */
export class StreamingAnalyzer {
  private samples: Float32Array;
  private sampleCount = 0;
  private nextWindow = 0;
  private windows: WindowResult[] = [];
  private startedAt = nowMs();

  constructor() {
    this.samples = new Float32Array(WIN * 4);
  }

  private ensureCapacity(need: number) {
    if (need <= this.samples.length) return;
    let cap = this.samples.length;
    while (cap < need) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.samples.subarray(0, this.sampleCount));
    this.samples = next;
  }

  push(chunk: Float32Array) {
    this.ensureCapacity(this.sampleCount + chunk.length);
    this.samples.set(chunk, this.sampleCount);
    this.sampleCount += chunk.length;
  }

  /** 返回新完成的窗口（含跨窗口平滑后的最新分数序列） */
  poll(): { newWindows: WindowResult[]; all: WindowResult[] } {
    const made: WindowResult[] = [];
    while (this.nextWindow * HOP + WIN <= this.sampleCount) {
      const w = analyzeWindow(
        this.samples,
        this.nextWindow * HOP,
        this.nextWindow
      );
      this.windows.push(w);
      made.push(w);
      this.nextWindow++;
    }
    if (this.windows.length) {
      smoothAndLabel(this.windows);
    }
    return { newWindows: made, all: this.windows };
  }

  /** 结束分析（含尾窗） */
  finalize(): AnalysisResult {
    const tailStart = this.nextWindow * HOP;
    const remain = this.sampleCount - tailStart;
    if (remain >= FRAME * 8) {
      this.windows.push(analyzeWindow(this.samples, tailStart, this.windows.length));
    }
    const t1 = nowMs();
    const dur = this.sampleCount / SR;
    return summarize(this.windows, dur, t1 - this.startedAt);
  }

  get recordedSamples(): number {
    return this.sampleCount;
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
