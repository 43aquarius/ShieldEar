/**
 * TTS 405 故障隔离实验
 * 目的：判断上游 TTS 接口的 405 WAF 拦截是「内容触发」还是「接口整体封禁」
 * 用法：bun scripts/tts-isolation-test.ts
 */
import ZAI from "z-ai-web-dev-sdk";

const CASES: { tag: string; text: string }[] = [
  { tag: "A-良性短句", text: "今天天气不错，我们一起去公园散步吧。" },
  {
    tag: "B-对照(工作通知)",
    text: "今天下午三点在会议室开项目评审会，请准备好上周的测试报告和数据材料，准时参加，不要迟到。会后我们再讨论下一阶段的排期。",
  },
  {
    tag: "C-诈骗话术1(亲属)",
    text: "妈，我是小明啊，我手机摔坏了，这是我同学的号码。我在外地出了点事，急需八千块钱周转，你先别问我爸，把钱转到我发你的这个账户上，事后我详细跟你解释。",
  },
  {
    tag: "D-诈骗话术2(领导)",
    text: "小王，我是张总。我现在在开一个重要会议，不方便接电话。有个紧急的付款事项需要你马上处理，把五十万转到这个账户，手续回头再补，现在马上办。",
  },
  {
    tag: "E-诈骗关键词单测",
    text: "把钱转到这个账户上。",
  },
  {
    tag: "F-良性中长句",
    text: "人工智能语音合成技术近年来发展迅速，语音鉴伪成为信息安全领域的重要课题。本平台演示完整的生成与检测闭环流程。",
  },
];

async function main() {
  const zai = await ZAI.create();
  for (const c of CASES) {
    try {
      const resp = await zai.audio.tts.create({
        input: c.text,
        voice: "tongtong",
        speed: 1.0,
        response_format: "wav",
        stream: false,
      });
      const ab = await resp.arrayBuffer();
      const buf = Buffer.from(new Uint8Array(ab));
      console.log(`[${c.tag}] OK  status=${resp.status} bytes=${buf.length}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 只取关键信息，避免整页 WAF HTML 刷屏
      const m = /status (\d+)/.exec(msg);
      const code = m ? m[1] : "unknown";
      console.log(`[${c.tag}] FAIL http=${code} len(msg)=${msg.length}`);
    }
    await new Promise((r) => setTimeout(r, 1500)); // 避免限流干扰实验
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
