/**
 * 探针：为 regression.test.ts 设定诚实断言阈值
 * 用 calibration/features.json 的 50 条真实特征向量过 scoreWindow，
 * 统计按信道的分离度、方向一致率，并与 testsuite_results.json 历史判决对齐。
 */
import featuresData from "../calibration/features.json";
import resultsData from "../calibration/testsuite_results.json";
import { scoreWindow } from "../src/lib/engine/calibration";

interface FeatRow {
  name: string;
  cls: string;
  channel: string;
  feats: Record<string, number>;
  voicedWindows: number;
}

const rows = featuresData as FeatRow[];
const scored = rows.map((r) => {
  const narrow = r.channel === "narrowband";
  const { score } = scoreWindow(r.feats as never, narrow);
  return { name: r.name, cls: r.cls, channel: r.channel, score };
});

const byChannel = (ch: string) => scored.filter((s) => s.channel === ch);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

for (const ch of ["wideband", "narrowband"]) {
  const sel = byChannel(ch);
  const tts = sel.filter((s) => s.cls === "tts").map((s) => s.score);
  const nat = sel.filter((s) => s.cls === "natural").map((s) => s.score);
  console.log(`\n[${ch}] n=${sel.length} (tts=${tts.length}, nat=${nat.length})`);
  console.log(`  tts mean=${mean(tts).toFixed(4)} min=${Math.min(...tts).toFixed(4)}`);
  console.log(`  nat mean=${mean(nat).toFixed(4)} max=${Math.max(...nat).toFixed(4)}`);
  // AUC
  let u = 0;
  for (const p of tts) for (const n of nat) u += p > n ? 1 : p === n ? 0.5 : 0;
  console.log(`  AUC=${(u / (tts.length * nat.length)).toFixed(4)}`);
  // 方向一致率（TTS>0.5 检出 / nat<0.5 放行）
  const ttsHit = tts.filter((s) => s >= 0.5).length;
  const natOk = nat.filter((s) => s < 0.5).length;
  console.log(`  tts>=0.5: ${ttsHit}/${tts.length}; nat<0.5: ${natOk}/${nat.length}`);
}

// 与历史逐文件判决对齐（按文件名匹配 items）
const items = (resultsData as { items: { name: string; risk: string; syntheticRatio: number }[] }).items;
let matched = 0, dirAgree = 0;
for (const s of scored) {
  const base = s.name.split("/").pop() || s.name;
  const it = items.find((i) => i.name.endsWith(base));
  if (!it) continue;
  matched++;
  const histDetect = it.risk === "HIGH" || it.risk === "CRITICAL";
  const myDetect = s.score >= 0.5;
  if (histDetect === myDetect) dirAgree++;
}
console.log(`\n与 testsuite_results 逐文件对齐: ${dirAgree}/${matched} 方向一致`);
console.log(`meta.engine = ${(resultsData as { meta: { engine: string } }).meta.engine}`);
