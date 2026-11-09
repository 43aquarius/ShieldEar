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
 *  - f0Std           基频韵律动态（窗内 F0 变异系数，v2.0 学术增强）
 *  - shimmer         振幅微扰（相邻基音周期峰值幅度扰动，v2.0 学术增强）
 *  - envMod45        包络调制占比（4–8Hz 音节律调制能量比，v2.0 学术增强）
 *
 * v2.0 学术增强实验记录（诚实工程边界）：
 *  - 相位域 MGD 类（群延迟参与比/平坦度等 6 形态）与倒谱纹理类（CQCC/LFCC
 *    思路 3 形态）在本数据集（单一 TTS 引擎 × 7 音色）上分离度均 <0.8，
 *    不入引擎（scripts/probe-v2-features.ts 全程可复现）；
 *  - 入选三特征分离度（宽带/窄带）：f0Std 1.26/1.41 · shimmer 1.08/0.95 ·
 *    envMod45 1.70/0.96，且双信道方向一致。
 *
 * v2.1 抗干扰鲁棒性（探针实证：scripts/probe-robustness.ts，11 扰动 × 15 源）：
 *  - 帧级/窗口级直流去除：+0.05 直流偏置（劣质声卡常见）原会使白相关峰值
 *    （HNR 代理）虚高、静音闸失效，致自然人声误报翻倍（FP 1→2，均值
 *    0.298→0.512）；去均值后恢复 clean 水平（258 判决基线逐位不变）；
 *  - 输入质量护栏 assessQuality：削波平顶比/直流偏置/底噪/电平四项诊断
 *    与警示（只提示不改变判决，随取证报告输出）。
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
  QUALITY_THRESHOLDS,
  type AnalysisResult,
  type AudioQuality,
  type ChannelType,
  type FeatureProfileItem,
  type QualityWarning,
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
/** 信道判定频点：3.5kHz（电话带外，只剩滤波泄漏；v2.0 修复） */
const CH_LO = Math.ceil(3500 / BIN_HZ); // 112
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

  // v2.1 窗口级直流去除：直流偏置会抬高 RMS 与静音闸（+0.05 DC 即可使
  // 全帧 RMS ≥ 0.05 > 闸值 0.005，静音窗被误判为语音窗），并污染包络闸。
  // 去均值后的 winRms 为真实交流电平（clean 音频均值 ≈ 0，数值不变）。
  let wSum = 0, wSq = 0;
  for (let i = 0; i < winLen; i++) {
    const v = pcm[start + i];
    wSum += v;
    wSq += v * v;
  }
  const winMean = wSum / winLen;
  const winRms = Math.sqrt(Math.max(wSq / winLen - winMean * winMean, 0));

  const nFrames = Math.max(0, Math.floor((winLen - FRAME) / FRAME_HOP) + 1);
  const activeRms: number[] = [];
  const hfFlatList: number[] = [];
  const hfRatioList: number[] = [];
  const fluxList: number[] = [];
  const zcrList: number[] = [];
  const hnrList: number[] = [];
  const periodList: number[] = [];
  const hfPeriodList: number[] = [];
  const shimmerList: number[] = [];
  const chRatioList: number[] = [];

  const { minLag, maxLag } = pitchLags();
  const hann = getHann(FRAME);
  // v2.1 帧级去均值缓冲：ZCR / FFT / 基音自相关 / shimmer 均在无直流域计算
  const frameZ = new Float32Array(FRAME);
  let prevMag: Float64Array | null = null;

  for (let fi = 0; fi < nFrames; fi++) {
    const fStart = start + fi * FRAME_HOP;
    const frame = pcm.subarray(fStart, fStart + FRAME);
    // v2.1 帧级去均值：直流会使过零率系统性偏低、自相关峰值（HNR 代理）
    // 虚高（+0.05 DC 实测使自然人声得分均值 0.298→0.512，误报翻倍）。
    // 所有帧域分析（RMS 闸 / FFT / ZCR / 基音 / shimmer）改在去均值域进行。
    let fSum = 0;
    for (let i = 0; i < FRAME; i++) fSum += frame[i];
    const fMean = fSum / FRAME;
    for (let i = 0; i < FRAME; i++) frameZ[i] = frame[i] - fMean;
    const frms = rms(frameZ, 0, FRAME);
    if (frms <= ENGINE_PARAMS.frameActiveRms) {
      prevMag = null; // 跨静音不做 flux
      continue;
    }
    activeRms.push(frms);

    // ---- FFT（一次计算，复用幅度谱与相位；输入为去均值帧） ----
    const re = new Float64Array(FFT);
    const im = new Float64Array(FFT);
    for (let i = 0; i < FRAME; i++) re[i] = frameZ[i] * hann[i];
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
    // 信道判定指标（v2.0 修复）：3.5kHz+ 功率占比
    // v1 潜伏缺陷：用 3.25kHz+ 幅度占比判窄带，带通泄漏使电话仿真音频
    // 占比达 0.02–0.034 > 阈值 0.015，窄带路径从未触发（实证：改窄带权重
    // 对全套测试结果零影响）。改用 3.5kHz+ 功率占比后：电话 ≤0.0044，
    // 宽带 ≥0.07，分离干净。
    {
      let p35 = 0, ptot = 0;
      for (let k = 1; k < BINS; k++) {
        const pw = re[k] * re[k] + im[k] * im[k];
        ptot += pw;
        if (k >= CH_LO) p35 += pw;
      }
      if (ptot > 1e-12) chRatioList.push(p35 / ptot);
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

    // 过零率（去均值域：直流不再系统性压低过零数）
    let zc = 0;
    for (let i = 1; i < frameZ.length; i++) {
      if ((frameZ[i - 1] >= 0 && frameZ[i] < 0) || (frameZ[i - 1] < 0 && frameZ[i] >= 0)) zc++;
    }
    zcrList.push(zc / frameZ.length);

    // ---- 基音分析（8kHz 抽取域，去均值帧） ----
    const decLen = Math.floor(FRAME / DEC);
    const dec = new Float32Array(decLen);
    for (let i = 0; i < decLen; i++) {
      dec[i] = (frameZ[i * DEC] + frameZ[i * DEC + 1]) * 0.5;
    }
    const peak = autocorrPeak(dec, 0, decLen, minLag, maxLag);
    if (peak.value > 0.35 && peak.refined > 0) {
      hnrList.push(peak.value);
      periodList.push(peak.refined);

      // ---- 振幅微扰 shimmer（v2.0）：相邻基音周期峰值幅度的相对扰动 ----
      // 自然声门开合/气流动力学的幅度微观起伏 vs 声码器幅度轨迹的平稳性
      {
        const period = Math.round(peak.refined);
        const nP = Math.floor(decLen / period);
        let sA = 0, nA = 0, prevA = -1;
        for (let pIdx = 0; pIdx < nP; pIdx++) {
          let amp = 0;
          for (let i = pIdx * period; i < (pIdx + 1) * period; i++) {
            const a = Math.abs(dec[i]);
            if (a > amp) amp = a;
          }
          if (prevA > 0 && prevA + amp > 1e-9) {
            sA += Math.abs(amp - prevA) / ((amp + prevA) / 2);
            nA++;
          }
          prevA = amp;
        }
        if (nA >= 2) shimmerList.push(sA / nA);
      }

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

  // 基频韵律动态（v2.0）：窗内浊音帧 F0 的变异系数
  // 自然语流的重音/语调起伏 → 慢速 F0 波动；合成语音韵律轨迹趋于平坦
  let f0Std = 0;
  if (periodList.length >= 6) {
    const f0s = periodList.map((p) => (SR / DEC) / p);
    const m = mean(f0s);
    if (m > 1e-6) f0Std = std(f0s) / m;
  }

  // 包络调制占比（v2.0）：4–8Hz 音节律调制能量 / 包络总调制能量（窗口级）
  // 神经 TTS 韵律模型产生规律化/夸张的音节律调制，与自然语流的调制分布存在系统差异
  let envMod45 = 0;
  if (winRms > 0.01) {
    const SUB = Math.round(0.02 * SR); // 20ms 子帧
    const nSub = Math.floor(winLen / SUB);
    if (nSub >= 16) {
      const env = new Float64Array(FFT);
      let em = 0;
      for (let i = 0; i < nSub; i++) {
        let s = 0;
        const b0 = start + i * SUB;
        for (let j = 0; j < SUB; j++) {
          const v = pcm[b0 + j] - winMean; // v2.1：去窗口均值，免直流污染
          s += v * v;
        }
        env[i] = Math.sqrt(s / SUB);
        em += env[i];
      }
      em /= nSub;
      const ere = new Float64Array(FFT);
      const eim = new Float64Array(FFT);
      for (let i = 0; i < nSub; i++) ere[i] = env[i] - em;
      fftInPlace(ere, eim);
      const envBinHz = 1 / (FFT * 0.02); // ≈0.0977Hz
      const mlo = Math.ceil(4 / envBinHz);
      const mhi = Math.floor(8 / envBinHz);
      let s45 = 0, tot = 0;
      for (let k = 1; k < FFT / 2; k++) {
        const p = Math.sqrt(ere[k] * ere[k] + eim[k] * eim[k]);
        tot += p;
        if (k >= mlo && k <= mhi) s45 += p;
      }
      if (tot > 1e-12) envMod45 = s45 / tot;
    }
  }

  // 信道判定：3.5kHz+ 功率占比极低 → 电话窄带信道（v2.0 修复，见上）
  const chRatioMean = chRatioList.length ? mean(chRatioList) : 0;
  const channel: ChannelType =
    opts.forcedChannel ??
    (chRatioMean < ENGINE_PARAMS.narrowbandHfRatio ? "narrowband" : "wideband");

  const features: RawFeatures = {
    hfFlatness: hfFlatList.length ? mean(hfFlatList) : 0,
    hfEnergyRatio: hfRatioList.length ? mean(hfRatioList) : 0,
    hnr: hnrList.length ? mean(hnrList) : 0,
    hnrCV: hnrList.length > 3 ? std(hnrList) / (mean(hnrList) + 1e-9) : 0,
    fluxCV: fluxList.length > 1 ? std(fluxList) / (mean(fluxList) + 1e-9) : 0,
    jitter: jitterList.length ? mean(jitterList) : 0,
    zcrCV: zcrList.length > 1 ? std(zcrList) / (mean(zcrList) + 1e-9) : 0,
    hfPeriodicity: hfPeriodList.length ? mean(hfPeriodList) : 0,
    f0Std,
    shimmer: shimmerList.length ? mean(shimmerList) : 0,
    envMod45,
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

/**
 * 输入质量护栏（v2.1）：削波平顶比 / 直流偏置 / 底噪 / 电平四项诊断。
 *
 * 只提示不改变判决 —— 判决逻辑与 258 条基线完全不变；质量警示用于
 * 向使用者说明「本次输入条件下结论的可靠边界」，随取证报告输出。
 * 阈值全部来自 scripts/probe-robustness.ts 的 11 扰动 × 15 源实证
 * （calibration/robustness_results.json，阈值与实测分布的间隔见
 *  QUALITY_THRESHOLDS 注释）。
 */
export function assessQuality(pcm: Float32Array): AudioQuality {
  const n = pcm.length;
  if (n === 0) {
    return { clippingRatio: 0, dcOffset: 0, noiseFloorDb: -120, peakDb: -120, warnings: [] };
  }
  let dc = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
    dc += pcm[i];
  }
  const dcOffset = dc / n;
  // 削波平顶比：|x| ≥ 0.98·peak 的样本占比（能检出非满幅削波，
  // 如 ±0.5 硬削波；clean 语音 < 0.001%，实测削波 0.03%~0.14%）
  let clip = 0;
  if (peak > QUALITY_THRESHOLDS.minPeak) {
    const rail = 0.98 * peak;
    for (let i = 0; i < n; i++) if (Math.abs(pcm[i]) >= rail) clip++;
  }
  const clippingRatio = clip / n;
  // 底噪估计：去均值后 20ms 子帧 RMS 的 5% 分位（与探针同口径；
  // 先去均值可避免直流偏置抬高底噪估计造成双重警示）
  const SUB = Math.round(0.02 * SR);
  const subs: number[] = [];
  for (let s = 0; s + SUB <= n; s += SUB) {
    let p = 0;
    for (let i = s; i < s + SUB; i++) {
      const v = pcm[i] - dcOffset;
      p += v * v;
    }
    subs.push(Math.sqrt(p / SUB));
  }
  subs.sort((a, b) => a - b);
  const floorRms = subs.length ? subs[Math.floor(subs.length * 0.05)] : 0;
  const noiseFloorDb = floorRms > 0 ? 20 * Math.log10(floorRms) : -120;
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -120;

  const warnings: QualityWarning[] = [];
  if (clippingRatio >= QUALITY_THRESHOLDS.clippingRatio) warnings.push("clipping");
  if (Math.abs(dcOffset) >= QUALITY_THRESHOLDS.dcOffset) warnings.push("dc-offset");
  if (noiseFloorDb > QUALITY_THRESHOLDS.noiseFloorDb) warnings.push("noisy-floor");
  if (peakDb < QUALITY_THRESHOLDS.peakDb) warnings.push("low-level");

  return { clippingRatio, dcOffset, noiseFloorDb, peakDb, warnings };
}

/** 计算整体结论（供整段分析与流式中间态共用） */
export function summarize(
  windows: WindowResult[],
  durationSec: number,
  analyzeMs: number,
  quality?: AudioQuality
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
    quality,
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
  // v2.1：输入质量护栏随整段判决一并返回（取证报告随附）
  return summarize(windows, pcm.length / SR, t1 - t0, assessQuality(pcm));
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

  /** 结束分析（含尾窗；v2.1：质量护栏覆盖实时鉴听路径） */
  finalize(): AnalysisResult {
    const tailStart = this.nextWindow * HOP;
    const remain = this.sampleCount - tailStart;
    if (remain >= FRAME * 8) {
      this.windows.push(analyzeWindow(this.samples, tailStart, this.windows.length));
    }
    const t1 = nowMs();
    const dur = this.sampleCount / SR;
    return summarize(
      this.windows,
      dur,
      t1 - this.startedAt,
      assessQuality(this.samples.subarray(0, this.sampleCount))
    );
  }

  get recordedSamples(): number {
    return this.sampleCount;
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
