/**
 * HTTP 回显服务器：转储每个请求的原始请求行与全部请求头
 * 用法：node scripts/echo-server.js 9999
 */
const http = require("http");
const port = Number(process.argv[2] || 9999);

http
  .createServer((req, res) => {
    let chunks = [];
    let meta = { method: req.method, url: req.url, httpVersion: req.httpVersion, rawHeaders: req.rawHeaders };
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const rec = {
        ...meta,
        bodyPreview: body.subarray(0, 80).toString("utf-8"),
        ts: new Date().toISOString(),
      };
      console.log("=== REQUEST ===");
      console.log(JSON.stringify(rec, null, 2));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ echo: true, received: meta.rawHeaders.length, tag: process.env.ECHO_TAG || "" }));
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`echo server on 127.0.0.1:${port}`));
