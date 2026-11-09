/**
 * 声盾 ShieldEar 引擎 — 学术口径评估指标（同构，无依赖）
 *
 * v1.3.13 自 scripts/run-testsuite.ts 抽取入引擎库：
 *  - 单一事实源：测试套件、单元测试、后续论文/报告数字共用同一实现；
 *  - 数学契约由 src/lib/engine/__tests__/metrics.test.ts 锚定
 *    （完美分离 / 完全重叠 / 已知小样本分布三类解析解对拍）。
 */

/**
 * EER（等错误率）：误报率 FAR = 漏报率 FRR 交叉点的错误率。
 *
 * 约定：分数越高越疑似合成（正类 pos = 合成，负类 neg = 自然）。
 * 实现：在全部观测分数上扫描阈值，取 max(FAR, FRR) 的最小值
 * （即两条错误率曲线交点的错误率，离散口径）。
 *
 * @returns EER ∈ [0,1]；任一侧样本为空时返回 NaN
 */
export function eerOf(pos: number[], neg: number[]): number {
  if (!pos.length || !neg.length) return NaN;
  const ths = [...new Set([...pos, ...neg])].sort((a, b) => a - b);
  let best = 1;
  for (const th of ths) {
    const far = neg.filter((s) => s >= th).length / neg.length; // 自然被误判为合成
    const frr = pos.filter((s) => s < th).length / pos.length; // 合成被漏判
    best = Math.min(best, Math.max(far, frr));
  }
  return Math.round(best * 10000) / 10000;
}

/**
 * AUC（排序区分度）：Mann-Whitney U 统计 —— P(合成分 > 自然分) + 0.5·P(相等)。
 *
 * 等价于随机抽取一个合成样本与一个自然样本时，合成分数更高的概率。
 * 完美分离 = 1，完全同分布 ≈ 0.5，反向排序 = 0。
 *
 * @returns AUC ∈ [0,1]；任一侧样本为空时返回 NaN
 */
export function aucOf(pos: number[], neg: number[]): number {
  if (!pos.length || !neg.length) return NaN;
  let u = 0;
  for (const p of pos) for (const n of neg) u += p > n ? 1 : p === n ? 0.5 : 0;
  return Math.round((u / (pos.length * neg.length)) * 10000) / 10000;
}
