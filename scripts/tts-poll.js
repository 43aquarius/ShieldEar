/**
 * 上游 /audio/tts 惩罚期轮询器（单次请求/5分钟，最小足迹）
 * 成功 → 写 /tmp/tts-poll-ok；最多 10 次（50 分钟）
 * 用法：nohup node scripts/tts-poll.js > /tmp/tts-poll.log 2>&1 &
 */
const http = require("http");
const fs = require("fs");

const cfg = JSON.parse(fs.readFileSync("/etc/.z-ai-config", "utf-8"));
const INTERVAL = 5 * 60 * 1000;
const MAX = 10;

function probe() {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      input: "通道恢复探测。",
      voice: "tongtong",
      speed: 1.0,
      response_format: "wav",
      stream: false,
    });
    const req = http.request(
      {
        hostname: "172.23.4.166",
        port: 8080,
        path: "/v1/audio/tts",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ShieldEar-Server/1.0",
          Accept: "*/*",
          Authorization: "Bearer " + cfg.apiKey,
          "X-Z-AI-From": "Z",
          "X-Token": cfg.token,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, bytes: buf.length, riff: buf.subarray(0, 4).toString() === "RIFF" });
        });
      }
    );
    req.setTimeout(30000, () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ status: -1, bytes: 0, riff: false, err: String(e).slice(0, 60) }));
    req.end(body);
  });
}

async function main() {
  for (let i = 1; i <= MAX; i++) {
    const r = await probe();
    const ts = new Date().toISOString();
    console.log(`[${ts}] probe ${i}/${MAX} -> status=${r.status} bytes=${r.bytes} riff=${r.riff}${r.err ? " err=" + r.err : ""}`);
    if (r.status === 200 && r.riff) {
      fs.writeFileSync("/tmp/tts-poll-ok", new Date().toISOString());
      console.log(">>> 上游通道已恢复 <<<");
      process.exit(0);
    }
    if (r.status === 429) {
      // 应用层限流说明 WAF 已放行 → 通道实际已恢复，只是限流
      fs.writeFileSync("/tmp/tts-poll-ok", new Date().toISOString() + " (rate-limited but WAF passed)");
      console.log(">>> WAF 已放行（应用层限流中）<<<");
      process.exit(0);
    }
    if (i < MAX) await new Promise((r2) => setTimeout(r2, INTERVAL));
  }
  console.log(">>> 50 分钟内未恢复 <<<");
  process.exit(2);
}
main();
