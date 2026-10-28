/**
 * Node fetch vs curl 差异定位：WAF 对缺 User-Agent 的请求拦截假设验证
 * 用法：bun scripts/tts-node-fetch-test.ts
 */
const CFG_PATH = "/etc/.z-ai-config";
const cfg = JSON.parse(require("fs").readFileSync(CFG_PATH, "utf-8"));
const url = `${cfg.baseUrl.replace(/\/+$/, "")}/audio/tts`;

const baseHeaders: Record<string, string> = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${cfg.apiKey}`,
  "X-Z-AI-From": "Z",
  "X-Token": cfg.token,
};
const body = JSON.stringify({
  input: "你好，今天天气不错。",
  voice: "tongtong",
  speed: 1.0,
  response_format: "wav",
  stream: false,
});

const variants: { tag: string; extra: Record<string, string> }[] = [
  { tag: "1-裸4头(现状)", extra: {} },
  { tag: "2-+UA(curl仿冒)", extra: { "User-Agent": "curl/8.5.0" } },
  { tag: "3-+UA(浏览器)", extra: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" } },
  { tag: "4-+Accept", extra: { Accept: "*/*" } },
  { tag: "5-+UA+Accept", extra: { "User-Agent": "curl/8.5.0", Accept: "*/*" } },
];

async function main() {
  for (const v of variants) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { ...baseHeaders, ...v.extra },
        body,
        signal: AbortSignal.timeout(30000),
      });
      const buf = Buffer.from(await resp.arrayBuffer());
      const wavOk = buf.subarray(0, 4).toString("ascii") === "RIFF";
      console.log(`[${v.tag}] http=${resp.status} bytes=${buf.length} wav=${wavOk}`);
    } catch (e) {
      console.log(`[${v.tag}] THROW ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}
function isWav(buf: Buffer) {
  return buf.subarray(0, 4).toString("ascii") === "RIFF";
}
main();
