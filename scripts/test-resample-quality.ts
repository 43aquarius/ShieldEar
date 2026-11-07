/**
 * test-resample-quality.ts — v1.3.9 重采样质量回归（bun scripts/test-resample-quality.ts）
 *
 * 对 /tmp/resample-test 下的多采样率容器样本：
 *   decodeWav → mixToMono → resampleTo16k（被测实现）→ analyzeBuffer（引擎）
 * 与同一音频的原生容器基线（同一管线）比对判决档位与均分；
 * 另附 scipy 参考降采样（16k 恒等路径）作为绝对参考。
 *
 * 通过标准（对应真机审计复现的跨档问题）：
 *   · 档位不降级（CRITICAL→HIGH 即失败）
 *   · |ΔmeanScore| ≤ 0.03（旧实现实测掉 0.05+）
 */
import fs from "fs";
import path from "path";
import { decodeWav, mixToMono } from "../src/lib/audio/wav";
import { resampleTo16k } from "../src/lib/engine/dsp";
import { analyzeBuffer } from "../src/lib/engine/engine";

const DIR = "/tmp/resample-test";
const CASES = ["tts_tongtong_0", "tts_luodo_0", "demo_natural_demo"];
const RATES = [32000, 44100, 48000];

function load16k(file: string): Float32Array {
  const buf = fs.readFileSync(path.join(DIR, file));
  const dec = decodeWav(new Uint8Array(buf).buffer as ArrayBuffer);
  const mono = mixToMono(dec.pcm, dec.channels);
  return resampleTo16k(mono, dec.sampleRate);
}

function riskRank(risk: string): number {
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(risk);
}

let failed = 0;
console.log("══ v1.3.9 重采样质量回归（基线=原生容器・同一管线）══");
for (const c of CASES) {
  const base = analyzeBuffer(load16k(`${c}.wav`));
  const b = base.overall;
  console.log(
    `\n[${c}] 基线(原生): ${b.risk} mean=${b.meanScore.toFixed(3)} max=${b.maxScore.toFixed(3)} verdict=${b.verdict}`
  );
  // scipy 参考降采样（16k 恒等路径）——新实现应与之接近
  const refFile = `${c}_ref16k.wav`;
  if (fs.existsSync(path.join(DIR, refFile))) {
    const ref = analyzeBuffer(load16k(refFile));
    const dr = ref.overall.meanScore - b.meanScore;
    const ok = riskRank(ref.overall.risk) >= riskRank(b.risk) && Math.abs(dr) <= 0.03;
    if (!ok) failed++;
    console.log(
      `  [参考] scipy直降16k: ${ref.overall.risk} mean=${ref.overall.meanScore.toFixed(3)} Δ=${dr >= 0 ? "+" : ""}${dr.toFixed(3)} ${ok ? "✓" : "✗"}`
    );
  }
  for (const r of RATES) {
    const t0 = Date.now();
    const a = analyzeBuffer(load16k(`${c}_${r}.wav`));
    const ms = Date.now() - t0;
    const d = a.overall.meanScore - b.meanScore;
    const levelOk = riskRank(a.overall.risk) >= riskRank(b.risk);
    const scoreOk = Math.abs(d) <= 0.03;
    const ok = levelOk && scoreOk;
    if (!ok) failed++;
    console.log(
      `  ${r}Hz → ${a.overall.risk} mean=${a.overall.meanScore.toFixed(3)} Δ=${d >= 0 ? "+" : ""}${d.toFixed(3)} ` +
        `(${ms}ms) ${ok ? "✓" : "✗ 跨档/超差"}${levelOk ? "" : " [档位降级!]"}${scoreOk ? "" : " [分差超限!]"}`
    );
  }
}

console.log(`\n══ ${failed === 0 ? "PASS — 多采样率容器判决稳定" : `FAIL（${failed} 项）`} ══`);
process.exit(failed === 0 ? 0 : 1);
