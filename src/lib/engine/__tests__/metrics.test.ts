/**
 * 学术口径指标数学契约测试（EER / AUC）
 * v1.3.13 自 run-testsuite.ts 抽取入引擎库时的迁移安全网：
 * 三类解析已知分布（完美分离 / 部分重叠 / 打平）逐一手工对拍。
 * 真实数据回归（与 calibration/testsuite_results.json 记录值复算一致）
 * 见 regression.test.ts。
 */
import { describe, it, expect } from "vitest";
import { eerOf, aucOf } from "../metrics";

describe("eerOf（等错误率）", () => {
  it("完美分离 → EER = 0", () => {
    expect(eerOf([0.9], [0.1])).toBe(0);
    expect(eerOf([0.6, 0.7, 0.8], [0.1, 0.2, 0.3])).toBe(0);
  });

  it("完全反向（自然分全高于合成分）→ EER = 1", () => {
    expect(eerOf([0.1, 0.2], [0.8, 0.9])).toBe(1);
  });

  it("手工对拍：pos=[0.4,0.6], neg=[0.2,0.8] → EER = 0.5", () => {
    // 阈值扫描：th=0.4 → FAR=1/2, FRR=0/2 → max 0.5；th=0.6 → FAR=1/2, FRR=1/2 → 0.5
    expect(eerOf([0.4, 0.6], [0.2, 0.8])).toBe(0.5);
  });

  it("手工对拍：pos=[0.9,0.95,0.99], neg=[0.9] → EER = 1/3（保留 4 位小数）", () => {
    // 最优阈值 th=0.95：FAR=0/1，FRR=1/3 → EER=0.3333
    expect(eerOf([0.9, 0.95, 0.99], [0.9])).toBe(0.3333);
  });

  it("同分布样本（离散扫描口径，小样本不趋近 0.5 而取交叉点）", () => {
    // pos=neg=[0.2,0.5,0.8]：最优 th=0.5 或 0.8 → max(FAR,FRR)=2/3
    expect(eerOf([0.2, 0.5, 0.8], [0.2, 0.5, 0.8])).toBeCloseTo(0.6667, 3);
  });

  it("任一侧为空 → NaN", () => {
    expect(eerOf([], [0.1])).toBeNaN();
    expect(eerOf([0.1], [])).toBeNaN();
  });
});

describe("aucOf（Mann-Whitney AUC）", () => {
  it("完美分离 → AUC = 1", () => {
    expect(aucOf([0.6, 0.7, 0.8], [0.1, 0.2, 0.3])).toBe(1);
  });

  it("完全反向 → AUC = 0", () => {
    expect(aucOf([0.1, 0.2], [0.8, 0.9])).toBe(0);
  });

  it("打平样本计 0.5：pos=[0.5,0.9], neg=[0.5,0.1] → AUC = 0.875", () => {
    // 对 (0.5,0.5)=0.5 · (0.5,0.1)=1 · (0.9,0.5)=1 · (0.9,0.1)=1 → 3.5/4
    expect(aucOf([0.5, 0.9], [0.5, 0.1])).toBe(0.875);
  });

  it("完全重叠 → AUC = 0.5", () => {
    expect(aucOf([0.2, 0.5, 0.8], [0.2, 0.5, 0.8])).toBe(0.5);
  });

  it("任一侧为空 → NaN", () => {
    expect(aucOf([], [0.1])).toBeNaN();
    expect(aucOf([0.1], [])).toBeNaN();
  });
});
