/**
 * 真实校准数据回归测试 —— 引擎的"判决不变性"护城河
 *
 * 数据源（随库提交，全流程可复现）：
 *   · calibration/features.json          50 条真实样本的逐文件均值特征向量
 *   · calibration/testsuite_results.json 258 条判决基线（v1.3.12 · 引擎 v2.0.0-calibrated）
 *
 * 三层锚定：
 *   1. 引擎元信息与基线快照逐字段一致（版本 / 参数 / 阈值漂移即报警）；
 *   2. features.json 特征向量重放 scoreWindow → 分离度不低于观测值减安全余量
 *      （宽带 AUC 0.93 / 窄带 0.90 实测；注意这是拟合集内样本，
 *        样本外指标见 testsuite_results.json 的 258 条全量基线）；
 *   3. metrics.ts（v1.3.13 自 run-testsuite.ts 抽取）对基线 items 复算
 *      EER/AUC，必须与抽取前记录值逐位一致 —— 迁移零行为变更的直接证据。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { scoreWindow } from "../calibration";
import { ENGINE_NAME, ENGINE_VERSION, ENGINE_PARAMS, SCORE_THRESHOLDS } from "../types";
import { eerOf, aucOf } from "../metrics";

interface FeatRow {
  name: string;
  cls: "natural" | "tts";
  channel: "wideband" | "narrowband";
  feats: Record<string, number>;
  voicedWindows: number;
}

interface ResultItem {
  id: string;
  group: string;
  name: string;
  cls: "natural" | "tts";
  channel: "wideband" | "narrowband";
  syntheticRatio: number;
  risk: string;
}

interface Baseline {
  meta: {
    engine: string;
    params: {
      sampleRate: number; windowSec: number; hopSec: number; frameMs: number; hopMs: number;
      fftSize: number; frameActiveRms: number; windowVoicedRatio: number; narrowbandHfRatio: number;
      thresholds: typeof SCORE_THRESHOLDS;
    };
  };
  items: ResultItem[];
  summary: {
    eerAuc: Record<
      "wideband" | "narrowband" | "pooled",
      { eer: number; auc: number; nPos: number; nNeg: number }
    >;
  };
}

const root = path.resolve(__dirname, "../../../..");
const features = JSON.parse(fs.readFileSync(path.join(root, "calibration/features.json"), "utf8")) as FeatRow[];
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, "calibration/testsuite_results.json"), "utf8")
) as Baseline;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

describe("基线快照锚定（版本 / 参数 / 阈值）", () => {
  it("引擎版本与基线一致", () => {
    expect(`${ENGINE_NAME} ${ENGINE_VERSION}`).toBe(baseline.meta.engine);
  });

  it("分析参数与基线一致（滑窗 / 帧 / FFT / 阈值）", () => {
    expect(ENGINE_PARAMS.sampleRate).toBe(baseline.meta.params.sampleRate);
    expect(ENGINE_PARAMS.windowSec).toBe(baseline.meta.params.windowSec);
    expect(ENGINE_PARAMS.hopSec).toBe(baseline.meta.params.hopSec);
    expect(ENGINE_PARAMS.frameMs).toBe(baseline.meta.params.frameMs);
    expect(ENGINE_PARAMS.hopMs).toBe(baseline.meta.params.hopMs);
    expect(ENGINE_PARAMS.fftSize).toBe(baseline.meta.params.fftSize);
    expect(ENGINE_PARAMS.frameActiveRms).toBe(baseline.meta.params.frameActiveRms);
    expect(ENGINE_PARAMS.windowVoicedRatio).toBe(baseline.meta.params.windowVoicedRatio);
    expect(ENGINE_PARAMS.narrowbandHfRatio).toBe(baseline.meta.params.narrowbandHfRatio);
    expect(SCORE_THRESHOLDS).toEqual(baseline.meta.params.thresholds);
  });
});

describe("真实特征向量重放（features.json × 50）", () => {
  const scored = features.map((r) => ({
    ...r,
    score: scoreWindow(r.feats as never, r.channel === "narrowband").score,
  }));

  it.each(["wideband", "narrowband"] as const)("%s：合成均值显著高于自然均值（差 ≥ 0.35）", (ch) => {
    const sel = scored.filter((s) => s.channel === ch);
    const tts = sel.filter((s) => s.cls === "tts").map((s) => s.score);
    const nat = sel.filter((s) => s.cls === "natural").map((s) => s.score);
    expect(mean(tts) - mean(nat)).toBeGreaterThan(0.35);
  });

  it.each(["wideband", "narrowband"] as const)("%s：AUC ≥ 0.85（观测 0.93 / 0.90，留安全余量）", (ch) => {
    const sel = scored.filter((s) => s.channel === ch);
    const auc = aucOf(
      sel.filter((s) => s.cls === "tts").map((s) => s.score),
      sel.filter((s) => s.cls === "natural").map((s) => s.score)
    );
    expect(auc).toBeGreaterThanOrEqual(0.85);
  });

  it.each(["wideband", "narrowband"] as const)("%s：合成侧 ≥0.5 检出率 ≥ 90%", (ch) => {
    const tts = scored.filter((s) => s.channel === ch && s.cls === "tts");
    expect(tts.filter((s) => s.score >= 0.5).length / tts.length).toBeGreaterThanOrEqual(0.9);
  });

  it("与 258 条基线的逐文件方向一致率 ≥ 92%（观测 48/50）", () => {
    let matched = 0;
    let agree = 0;
    for (const s of scored) {
      const it = baseline.items.find((i) => i.name === s.name);
      if (!it) continue;
      matched++;
      const histDetect = it.risk === "HIGH" || it.risk === "CRITICAL";
      if (histDetect === (s.score >= 0.5)) agree++;
    }
    expect(matched).toBeGreaterThanOrEqual(50);
    expect(agree / matched).toBeGreaterThanOrEqual(0.92);
  });
});

describe("metrics 抽取迁移安全（v1.3.13 run-testsuite → 引擎库）", () => {
  // 用抽取后的 metrics.ts 对基线 items 全量复算，必须与抽取前的记录值逐位一致
  const byChannel = (ch: "wideband" | "narrowband") => {
    const pos = baseline.items.filter((i) => i.cls === "tts" && i.channel === ch).map((i) => i.syntheticRatio);
    const neg = baseline.items.filter((i) => i.cls === "natural" && i.channel === ch).map((i) => i.syntheticRatio);
    return { pos, neg };
  };

  it.each(["wideband", "narrowband"] as const)("%s：EER/AUC 复算 = 基线记录值", (ch) => {
    const { pos, neg } = byChannel(ch);
    const rec = baseline.summary.eerAuc[ch];
    expect(eerOf(pos, neg)).toBe(rec.eer);
    expect(aucOf(pos, neg)).toBe(rec.auc);
    expect(pos.length).toBe(rec.nPos);
    expect(neg.length).toBe(rec.nNeg);
  });

  it("pooled：EER/AUC 复算 = 基线记录值", () => {
    const pos = baseline.items.filter((i) => i.cls === "tts").map((i) => i.syntheticRatio);
    const neg = baseline.items.filter((i) => i.cls === "natural").map((i) => i.syntheticRatio);
    const rec = baseline.summary.eerAuc.pooled;
    expect(eerOf(pos, neg)).toBe(rec.eer);
    expect(aucOf(pos, neg)).toBe(rec.auc);
  });

  it("基线全量判决数 = 258（防数据文件被误改）", () => {
    expect(baseline.items).toHaveLength(258);
    expect(features).toHaveLength(50);
  });
});
