/**
 * Edge TTS 输出 × 声盾引擎判决验证
 * 用法：bun scripts/edge-tts-engine-test.ts
 * 生成若干诈骗话术文本 → Edge TTS 合成 → ffmpeg 转 16kHz mono → analyzeBuffer 判决
 */
import { execSync } from "child_process";
import { analyzeBuffer } from "../src/lib/engine/engine";
import { int16ToFloat } from "../src/audio-shim";

interface Case {
  tag: string;
  text: string;
  voice: string;
}

const CASES: Case[] = [
  { tag: "E1-冒充公检法", text: "您好，这里是公安局刑侦大队。您的银行账户涉嫌洗钱案件，需要将资金转入国家安全账户配合调查，否则将立即对您实施逮捕。", voice: "zh-CN-YunxiNeural" },
  { tag: "E2-冒充客服", text: "尊敬的客户您好，我是电商平台客服。您购买的商品在运输过程中出现质量问题，我们可以为您办理退款理赔，请您点击短信中的链接填写银行卡信息。", voice: "zh-CN-XiaoxiaoNeural" },
  { tag: "E3-冒充领导", text: "小王啊，我是张总。我现在正在开一个重要会议不方便打电话，你先帮我垫付一笔供应商的款项，转到这个账号，回头开会结束我马上批给你。", voice: "zh-CN-YunjianNeural" },
  { tag: "E4-正常陈述(对照)", text: "今天下午三点，我们在图书馆二楼的会议室讨论毕业设计的中期检查安排，请大家提前准备好各自的进展汇报材料。", voice: "zh-CN-XiaoyiNeural" },
];

async function edgeTts(text: string, voice: string, outMp3: string) {
  try {
    execSync(
      `python3 -m edge_tts --voice ${voice} --rate=+0% --text ${JSON.stringify(text)} --write-media ${outMp3}`,
      { timeout: 90_000, stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer | string };
    const msg = err.stderr ? Buffer.from(err.stderr as Buffer).toString().slice(-300) : String(e).slice(0, 200);
    throw new Error(`edge_tts 失败: ${msg}`);
  }
}

function mp3ToPcm16k(mp3: string, wav: string) {
  execSync(`ffmpeg -y -i ${mp3} -ar 16000 -ac 1 -c:a pcm_s16le ${wav}`, {
    timeout: 30_000,
    stdio: "pipe",
  });
}

async function main() {
  // 动态引入项目内 wav 解码（ESM/TS 路径）
  const { decodeWav, mixToMono } = await import("../src/lib/audio/wav");
  const { resampleTo16k } = await import("../src/lib/engine/dsp");
  const fs = await import("fs");

  for (const c of CASES) {
    const mp3 = `/tmp/edge-${c.tag}.mp3`;
    const wav = `/tmp/edge-${c.tag}.wav`;
    try {
      await edgeTts(c.text, c.voice, mp3);
      mp3ToPcm16k(mp3, wav);
      const buf = fs.readFileSync(wav);
      const decoded = decodeWav(new Uint8Array(buf));
      const mono = mixToMono(decoded.pcm, decoded.channels);
      const pcm16k = decoded.sampleRate === 16000 ? mono : resampleTo16k(mono, decoded.sampleRate);
      const r = analyzeBuffer(pcm16k);
      console.log(
        `[${c.tag}] risk=${r.overall.risk} ratio=${r.overall.syntheticRatio.toFixed(3)} ` +
        `win=${r.audio.voicedWindows}/${r.audio.totalWindows} ` +
        `dur=${r.audio.durationSec.toFixed(1)}s verdict=${r.overall.verdict.slice(0, 40)}`
      );
    } catch (e) {
      console.log(`[${c.tag}] FAIL ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
