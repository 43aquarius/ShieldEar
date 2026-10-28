/**
 * 声盾测试集扩充 — 新增 3 条文本 × 7 音色 = 21 段合成样本
 * 与校准集（tts_*.wav）文本级不相交，构成独立测试集（holdout）
 * 2026-10-28 起改用 src/lib/server/tts-client.ts 直连通道：
 * SDK(undici fetch) 会被上游 WAF 以 sec-fetch-mode/user-agent 指纹拦截 405
 */
import { synthesizeSpeech } from '../src/lib/server/tts-client';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'calibration', 'audio');

const TEXTS = [
  '喂，是张会计吗？我是王总啊，我现在在开一个重要会议，信号不太好。你马上把三十万合同保证金转到我发你的这个账户，事情紧急，会后我给你回电话解释。',
  '您好，这里是电商平台客服中心。检测到您的账户存在异常订单，为避免资金损失，请立即配合我们进行身份验证，并将款项转入安全账户进行保护。',
  'The quick brown fox jumps over the lazy dog. She sells seashells by the seashore, and the sound of the ocean waves never fades away in the evening light.',
];

const VOICES = ['tongtong', 'chuichui', 'xiaochen', 'jam', 'kazi', 'douji', 'luodo'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function genWithRetry(input: string, voice: string, tries = 5) {
  for (let t = 0; t < tries; t++) {
    try {
      return await synthesizeSpeech({ input, voice, speed: 1.0, response_format: 'wav' });
    } catch (e) {
      console.error(`  retry ${t + 1}/${tries}: ${String(e).slice(0, 80)}`);
      await sleep(15000 + t * 15000);
    }
  }
  return null;
}

async function main() {
  for (const voice of VOICES) {
    for (let ti = 0; ti < TEXTS.length; ti++) {
      const out = path.join(OUT, `tts2_${voice}_${ti}.wav`);
      if (fs.existsSync(out) && fs.statSync(out).size > 1000) {
        console.log('skip', out);
        continue;
      }
      const buf = await genWithRetry(TEXTS[ti], voice);
      if (buf) {
        fs.writeFileSync(out, buf);
        console.log('OK', out, buf.length);
      } else {
        console.error('GIVE UP', voice, ti);
      }
    }
  }
  console.log('DONE tts2 generation');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
