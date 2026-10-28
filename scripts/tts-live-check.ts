/**
 * 上游 TTS 直连单点验证（导入真实 tts-client 模块）
 * 用法：先确保 .tts-endpoint-override 已删除，然后：
 *   bun scripts/tts-live-check.ts
 */
import { synthesizeSpeech } from "../src/lib/server/tts-client";
import fs from "fs";

async function main() {
  const t0 = Date.now();
  const buf = await synthesizeSpeech({
    input: "你好，这是一次通道恢复验证。",
    voice: "tongtong",
    speed: 1.0,
    response_format: "wav",
  });
  const ms = Date.now() - t0;
  fs.writeFileSync("/tmp/tts-live-check.wav", buf);
  console.log(
    `OK bytes=${buf.length} RIFF=${buf.subarray(0, 4).toString("ascii") === "RIFF"} 耗时=${ms}ms`
  );
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message.slice(0, 150) : e);
  process.exit(1);
});
