/**
 * 本地假 TTS 服务器（诊断用）：POST /v1/audio/tts
 * 按请求中的 voice 返回校准集对应的真实 TTS WAV（不上游）
 * 用法：node scripts/fake-tts-server.js 9998
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const AUDIO_DIR = path.join(__dirname, "..", "calibration", "audio");
const port = Number(process.argv[2] || 9998);

http
  .createServer((req, res) => {
    let chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        const voice = body.voice || "tongtong";
        // 按音色挑选校准 WAV（优先 _0，缺则任一）
        const candidates = fs
          .readdirSync(AUDIO_DIR)
          .filter((f) => f.startsWith(`tts_${voice}_`) && f.endsWith(".wav"))
          .sort();
        if (!candidates.length) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `no sample for voice ${voice}` }));
          return;
        }
        const wav = fs.readFileSync(path.join(AUDIO_DIR, candidates[0]));
        console.log(
          `[fake-tts] ${new Date().toISOString()} voice=${voice} text=${(body.input || "").slice(0, 18)}… → ${candidates[0]} (${wav.length}B)`
        );
        res.writeHead(200, {
          "Content-Type": "audio/wav",
          "Content-Length": wav.length,
        });
        res.end(wav);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`fake TTS server on http://127.0.0.1:${port}/v1/audio/tts`)
  );
