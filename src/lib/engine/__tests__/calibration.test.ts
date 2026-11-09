/**
 * 评分校准模块契约测试
 * 锚定 z 标准化、限幅、双信道权重表、逻辑回归合成的数学性质 ——
 * 这是"可解释引擎"的核心承诺：每个判决可逐特征追溯，
 * 追溯链条上任何一环（先验、权重、限幅、合成）漂移都必须在此报警。
 */
import { describe, it, expect } from "vitest";
import {
  FEATURE_META,
  NATURAL_PRIORS_WB,
  NATURAL_PRIORS_NB,
  WEIGHTS_WIDEBAND,
  WEIGHTS_NARROWBAND,
  SCORE_KEYS,
  naturalPriors,
  featureZ,
  scoreWindow,
} from "../calibration";
import type { RawFeatures } from "../types";

/** 以先验中心为值的特征向量（z 全零） */
function priorFeatures(channel: "wideband" | "narrowband"): RawFeatures {
  const p = naturalPriors(channel);
  const f = {} as Record<string, number>;
  for (const k of SCORE_KEYS) f[k] = p[k].mu;
  f.voicedRatio = 1;
  return f as unknown as RawFeatures;
}

describe("featureZ（z 标准化）", () => {
  it("先验中心 → z=0；1σ → z=1；2σ → z=2（宽带）", () => {
    expect(featureZ("hnr", NATURAL_PRIORS_WB.hnr.mu, "wideband")).toBeCloseTo(0, 10);
    expect(featureZ("hnr", NATURAL_PRIORS_WB.hnr.mu + NATURAL_PRIORS_WB.hnr.sigma, "wideband")).toBeCloseTo(1, 10);
    expect(featureZ("hnr", NATURAL_PRIORS_WB.hnr.mu - 2 * NATURAL_PRIORS_WB.hnr.sigma, "wideband")).toBeCloseTo(-2, 10);
  });

  it("限幅 ±3（极端值不无限放大）", () => {
    expect(featureZ("hnr", 1e6, "wideband")).toBe(3);
    expect(featureZ("hnr", -1e6, "wideband")).toBe(-3);
  });

  it("双信道先验独立（同值不同信道 → 不同 z）", () => {
    const v = 0.5;
    expect(featureZ("hnr", v, "wideband")).not.toBe(featureZ("hnr", v, "narrowband"));
  });

  it("窄带 z 相对窄带先验计算", () => {
    expect(featureZ("f0Std", NATURAL_PRIORS_NB.f0Std.mu, "narrowband")).toBeCloseTo(0, 10);
  });
});

describe("scoreWindow（线性合成 + logistic）", () => {
  it("先验中心特征 → 低分（远低于 0.5 疑似阈值）", () => {
    const wb = scoreWindow(priorFeatures("wideband"), false).score;
    const nb = scoreWindow(priorFeatures("narrowband"), true).score;
    expect(wb).toBeCloseTo(1 / (1 + Math.exp(1.504)), 6); // sigmoid(bias)
    expect(nb).toBeCloseTo(1 / (1 + Math.exp(0.991)), 6);
    expect(wb).toBeLessThan(0.5);
    expect(nb).toBeLessThan(0.5);
  });

  it("logit 可逆：sigmoid⁻¹(score) = bias + Σ contributions", () => {
    const f = priorFeatures("wideband");
    f.hnr = 0.8;
    f.envMod45 = 0.4;
    f.shimmer = 0.05;
    const { score, contributions } = scoreWindow(f, false);
    const sum = Object.values(contributions).reduce((a, b) => a + b, 0);
    const logit = Math.log(score / (1 - score));
    expect(logit).toBeCloseTo(WEIGHTS_WIDEBAND.bias + sum, 9);
  });

  it("逐特征单调性：正权重特征↑→分数不减，负权重特征↓→分数不减", () => {
    const base = scoreWindow(priorFeatures("wideband"), false).score;
    for (const k of SCORE_KEYS) {
      const w = WEIGHTS_WIDEBAND[k];
      const f = priorFeatures("wideband");
      const p = naturalPriors("wideband");
      if (w > 0) {
        (f as unknown as Record<string, number>)[k] = p[k].mu + 2 * p[k].sigma; // 向合成侧偏移
      } else {
        (f as unknown as Record<string, number>)[k] = p[k].mu - 2 * p[k].sigma; // 负权重：低于先验 → 合成侧
      }
      const s = scoreWindow(f, false).score;
      expect(s).toBeGreaterThan(base);
    }
  });

  it("窄带不计分特征不变性：六个零权重特征任意改变，窄带分数逐位不变", () => {
    // v2.0 实证决策：新三特征 + 三个高频特征在退化窄带上被信道噪声主导，
    // 权重清零。此处锚定「清零」这一承诺本身。
    const zeroKeys = ["hfFlatness", "hfEnergyRatio", "hfPeriodicity", "f0Std", "shimmer", "envMod45"] as const;
    const base = scoreWindow(priorFeatures("narrowband"), true).score;
    for (const k of zeroKeys) {
      const f = priorFeatures("narrowband");
      (f as unknown as Record<string, number>)[k] = k === "hfFlatness" ? 1 : 0; // 极端值
      expect(scoreWindow(f, true).score).toBe(base); // 逐位相等（贡献 zk·0 = +0）
    }
  });

  it("窄带权重表：恰为 5 个非零特征 + bias", () => {
    const nonzero = SCORE_KEYS.filter((k) => WEIGHTS_NARROWBAND[k] !== 0);
    expect(nonzero.sort()).toEqual(["fluxCV", "hnr", "hnrCV", "jitter", "zcrCV"]);
  });
});

describe("元数据一致性（展示层与计分层同源）", () => {
  it("FEATURE_META 与 SCORE_KEYS 键集合完全一致（11 维）", () => {
    expect(FEATURE_META).toHaveLength(11);
    expect(SCORE_KEYS).toHaveLength(11);
    expect(FEATURE_META.map((m) => m.key)).toEqual([...SCORE_KEYS]);
  });

  it("宽带权重表覆盖全部 11 特征 + bias", () => {
    const wKeys = Object.keys(WEIGHTS_WIDEBAND).filter((k) => k !== "bias");
    expect(wKeys.sort()).toEqual([...SCORE_KEYS].sort());
    expect(typeof WEIGHTS_WIDEBAND.bias).toBe("number");
  });
});
