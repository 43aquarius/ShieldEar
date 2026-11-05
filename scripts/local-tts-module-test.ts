/**
 * local-tts 模块单测：验证 Edge / espeak 合成在受限 PATH 环境下可用
 * 用法（模拟 next-server 无 .venv PATH）：
 *   env -i PATH=/usr/bin:/bin HOME=/home/z bun scripts/local-tts-module-test.ts
 */
import { synthesizeEdge, synthesizeEspeak } from "../src/lib/server/local-tts";
import { decodeWav, mixToMono } from "../src/lib/audio/wav";
import { resampleTo16k } from "../src/lib/engine/dsp";
import { analyzeBuffer } from "../src/lib/engine/engine";

async function main() {
  const text = "小王，我是张总。我现在在开重要会议，把五十万转到这个账户，马上办。";

  console.log("[Tier2 Edge] 开始合成…");
  const t0 = Date.now();
  const edge = await synthesizeEdge(text, "xiaochen", 1.0);
  console.log(
    `[Tier2 Edge] OK engine=${edge.engine} mp3=${edge.originalBuffer.length}B wav=${edge.wavBuffer.length}B ` +
    `label=${edge.engineLabel} 耗时=${Date.now() - t0}ms`
  );

  console.log("[Tier3 espeak] 开始合成…");
  const t1 = Date.now();
  const esp = await synthesizeEspeak(text, "xiaochen", 1.0);
  console.log(
    `[Tier3 espeak] OK engine=${esp.engine} wav=${esp.wavBuffer.length}B 耗时=${Date.now() - t1}ms`
  );

  // 两个产物跑引擎判决（验证检出闭环）
  for (const [name, s] of [["Edge", edge], ["espeak", esp]] as const) {
    const decoded = decodeWav(s.wavBuffer);
    const mono = mixToMono(decoded.pcm, decoded.channels);
    const pcm16k = resampleTo16k(mono, decoded.sampleRate);
    const r = analyzeBuffer(pcm16k);
    console.log(
      `[判决·${name}] risk=${r.overall.risk} ratio=${r.overall.syntheticRatio.toFixed(3)} ` +
      `dur=${r.audio.durationSec.toFixed(1)}s verdict=${r.overall.verdict.slice(0, 20)}`
    );
  }
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
