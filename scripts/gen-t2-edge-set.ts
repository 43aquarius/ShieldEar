/**
 * T2 独立合成测试集生成 — Edge 神经 TTS 跨引擎泛化考察（测试报告补测）
 * ─────────────────────────────────────────────────────────────────
 * 背景：T1 校准集样本来自 z-ai 神经 TTS（同时用于权重拟合，属内表
 * 现考察）。原 T2 计划用同引擎新文本，因生成通道受限缺席。
 *
 * 本轮升级：改用与 z-ai 完全独立的第二 TTS 引擎 —— 微软 Edge 神经
 * 语音（8 个中文音色），构成「引擎级 + 文本级」双重不相交的独立测
 * 试集，考察引擎权重的跨声码器泛化能力：
 *   · 引擎级：Edge 神经声码器 ≠ z-ai 声码器（不同厂商、不同声学栈）
 *   · 文本级：3 条全新文本（冒充公检法、冒充电商客服、新闻播报对照）
 *              与 T1 三条文本零重叠
 *
 * 产物：calibration/audio/tts2_<voice>_<n>.wav（16kHz 单声道，24 段）
 * 命名兼容 run-testsuite.ts 的 T2 识别规则（^tts2_.*\.wav$）。
 *
 * 复现：bun scripts/gen-t2-edge-set.ts
 */
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);
const OUT_DIR = path.join(process.cwd(), "calibration", "audio");

/** Edge 中文神经音色全表（8 音色，独立于 z-ai 音色体系） */
const EDGE_VOICES: Array<{ key: string; voice: string; label: string }> = [
  { key: "xiaoxiao", voice: "zh-CN-XiaoxiaoNeural", label: "晓晓·温暖女声" },
  { key: "xiaoyi", voice: "zh-CN-XiaoyiNeural", label: "晓伊·活泼女声" },
  { key: "yunjian", voice: "zh-CN-YunjianNeural", label: "云健·沉稳男声" },
  { key: "yunxi", voice: "zh-CN-YunxiNeural", label: "云希·阳光男声" },
  { key: "yunxia", voice: "zh-CN-YunxiaNeural", label: "云夏·自然男声" },
  { key: "yunyang", voice: "zh-CN-YunyangNeural", label: "云扬·新闻男声" },
  { key: "xiaobei", voice: "zh-CN-liaoning-XiaobeiNeural", label: "小贝·东北女声" },
  { key: "xiaoni", voice: "zh-CN-shaanxi-XiaoniNeural", label: "小妮·陕西女声" },
];

/** 3 条全新文本（与 T1 的亲属求助/会议通知/英文演示零重叠） */
const TEXTS: Array<{ id: string; text: string; tag: string }> = [
  {
    id: "1",
    tag: "冒充公检法诈骗话术",
    text: "我是市公安局刑侦支队的警官，你名下的银行账户涉嫌一起特大洗钱案件，现在已对你立案侦查。请你立即配合资金清查，把账户里的全部款项转入国家安全账户配合调查，否则我们将依法对你实施逮捕。",
  },
  {
    id: "2",
    tag: "冒充电商客服退款话术",
    text: "您好，这里是电商平台官方客服中心。系统检测到您上个月购买的商品存在质量问题，现在为您办理三倍赔付。请点击短信里的链接，输入您的银行卡号和手机验证码，退款将在十分钟内原路退回到您的账户。",
  },
  {
    id: "3",
    tag: "新闻播报（中性对照）",
    text: "各位听众早上好，下面播送城市新闻。今日全市天气晴朗，气温十八到二十六度，空气质量良好。早高峰期间各主要道路交通总体平稳，轨道交通各线路运行正常，请市民朋友合理安排出行时间。",
  },
];

async function synthOne(voice: string, text: string, outWav: string) {
  const mp3 = outWav.replace(/\.wav$/, ".mp3");
  await execFileAsync(
    "/home/z/.venv/bin/python3",
    [
      "-m", "edge_tts",
      "--voice", voice,
      "--rate=+0%",
      "--text", text,
      "--write-media", mp3,
    ],
    { timeout: 45_000, maxBuffer: 16 * 1024 * 1024 }
  );
  const stat = fs.statSync(mp3);
  if (stat.size < 2000) throw new Error(`Edge TTS 输出过短（${stat.size}B）`);
  await execFileAsync(
    "ffmpeg",
    ["-y", "-i", mp3, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outWav],
    { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }
  );
  fs.unlinkSync(mp3);
  const wav = fs.readFileSync(outWav);
  if (wav.subarray(0, 4).toString("ascii") !== "RIFF" || wav.length < 2000) {
    throw new Error("WAV 转码失败");
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let ok = 0;
  const failed: string[] = [];
  for (const v of EDGE_VOICES) {
    for (const t of TEXTS) {
      const out = path.join(OUT_DIR, `tts2_${v.key}_${t.id}.wav`);
      if (fs.existsSync(out)) {
        console.log(`skip 已存在: ${path.basename(out)}`);
        ok++;
        continue;
      }
      try {
        await synthOne(v.voice, t.text, out);
        const kb = Math.round(fs.statSync(out).size / 1024);
        console.log(`OK ${path.basename(out)} (${kb}KB) [${v.label} · ${t.tag}]`);
        ok++;
      } catch (e) {
        console.error(`FAIL ${v.key}#${t.id}: ${e instanceof Error ? e.message : String(e)}`);
        failed.push(`${v.key}#${t.id}`);
      }
    }
  }
  console.log(`\n完成: ${ok}/24，失败: ${failed.length}${failed.length ? " → " + failed.join(",") : ""}`);
  if (failed.length > 0) process.exit(1);
}

main();
