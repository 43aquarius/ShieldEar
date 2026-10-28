/**
 * WAF 内容规则定位实验：node:http + 不同UA × 良性/诈骗文本
 * 判读：405=WAF内容拦截（在限流之前）；429/200=已穿过WAF到达应用
 * 用法：bun scripts/tts-content-test.ts
 */
const cfg = JSON.parse(require("fs").readFileSync("/etc/.z-ai-config", "utf-8"));
const http = require("http");

const FRAUD = "妈，我是小明啊，我手机摔坏了，这是我同学的号码。我在外地出了点事，急需八千块钱周转，你先别问我爸，把钱转到我发你的这个账户上，事后我详细跟你解释。";
const BENIGN = "今天下午三点在会议室开项目评审会，请准备好上周的测试报告和数据材料。";

const CASES = [
  { tag: "A-自定义UA+良性", ua: "ShieldEar-Server/1.0", text: BENIGN },
  { tag: "B-自定义UA+诈骗", ua: "ShieldEar-Server/1.0", text: FRAUD },
  { tag: "C-curl UA+诈骗", ua: "curl/8.14.1", text: FRAUD },
  { tag: "D-Bun UA+诈骗", ua: "Bun/1.3.14", text: FRAUD },
  { tag: "E-node UA+良性", ua: "node", text: BENIGN },
  { tag: "F-node UA+诈骗", ua: "node", text: FRAUD },
];

function once(ua: string, text: string): Promise<{ status: number; bytes: number; head: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ input: text, voice: "tongtong", speed: 1.0, response_format: "wav", stream: false });
    const req = http.request(
      {
        hostname: "172.23.4.166", port: 8080, path: "/v1/audio/tts", method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": ua,
          Accept: "*/*",
          Authorization: "Bearer " + cfg.apiKey,
          "X-Z-AI-From": "Z",
          "X-Token": cfg.token,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res: any) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, bytes: buf.length, head: buf.subarray(0, 40).toString("utf-8").replace(/\s+/g, " ") });
        });
      }
    );
    req.setTimeout(30000, () => req.destroy(new Error("timeout")));
    req.on("error", (e: any) => resolve({ status: -1, bytes: 0, head: e.message.slice(0, 40) }));
    req.end(body);
  });
}

async function main() {
  for (const c of CASES) {
    const r = await once(c.ua, c.text);
    const verdict = r.status === 405 ? "WAF拦截" : r.status === 429 ? "过WAF→限流" : r.status === 200 ? "过WAF→成功" : "其他";
    console.log(`[${c.tag}] http=${r.status} ${verdict} bytes=${r.bytes} head="${r.head.slice(0, 30)}"`);
    await new Promise((r2) => setTimeout(r2, 2000));
  }
}
main();
