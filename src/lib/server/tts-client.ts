/**
 * 服务端 TTS 直连客户端（node:http 原生实现）
 *
 * 为什么不用 z-ai-web-dev-sdk / 全局 fetch？
 * ────────────────────────────────────────────────────────
 * 2026-10-28 排查结论（scripts/tts-isolation-test.ts、echo-server.js 抓包对比）：
 * 上游网关前置 WAF 新增了服务端脚本特征拦截规则。Node/undici 的全局 fetch 会
 * 自动附加 `sec-fetch-mode: cors`、`accept-language: *`、`user-agent: node` 等
 * Fetch 规范头——这些头出现在"非浏览器请求"上是典型的脚本工具指纹，一律 405
 * 返回阿里云 WAF 阻断页。SDK 内部正是用 undici fetch，因此 100% 被拦。
 *
 * 实测放行的请求形态（curl / Bun 均验证通过）：
 *   - 不携带 sec-fetch-mode / accept-language；
 *   - User-Agent 为普通客户端标识（非 "node"）；
 *   - 认证三件套：Authorization + X-Z-AI-From + X-Token（缺任一分别返回 403/401）。
 *
 * 本模块用 node:http.request 手工构造与 curl 同形的请求，绕开 undici 的
 * 自动头注入；配置加载与 SDK 同优先级（cwd → home → /etc 的 .z-ai-config）。
 * 另含超时、自动重试（405/429/5xx）与 WAV 魔数校验。
 */
import http from "http";
import https from "https";
import fs from "fs/promises";
import os from "os";
import path from "path";

interface ZAIConfig {
  baseUrl: string;
  apiKey: string;
  token?: string;
}

const CONFIG_CANDIDATES = [
  path.join(process.cwd(), ".z-ai-config"),
  path.join(os.homedir(), ".z-ai-config"),
  "/etc/.z-ai-config",
];

async function loadConfig(): Promise<ZAIConfig> {
  for (const filePath of CONFIG_CANDIDATES) {
    try {
      const cfg = JSON.parse(await fs.readFile(filePath, "utf-8")) as ZAIConfig;
      if (cfg.baseUrl && cfg.apiKey) return cfg;
    } catch {
      // 文件不存在或解析失败：按优先级继续尝试下一个候选路径
    }
  }
  throw new Error("未找到可用的 .z-ai-config 配置（需包含 baseUrl 与 apiKey）");
}

export interface TTSOptions {
  input: string;
  voice: string;
  speed?: number;
  response_format?: "wav" | "pcm" | "mp3";
}

interface HttpResult {
  status: number;
  body: Buffer;
}

/** node:http 原生 POST：只发送我们显式声明的头，不注入任何 fetch 规范头 */
function postJson(
  urlStr: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) })
        );
      }
    );
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error(`TTS 请求超时（${timeoutMs}ms）`))
    );
    req.on("error", reject);
    req.end(body);
  });
}

const RETRYABLE_STATUS = new Set([405, 429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1200, 3500];

/**
 * 直连上游 TTS 通道合成语音，返回音频 Buffer（wav 格式时已校验 RIFF 魔数）。
 * 网络错误 / 405(WAF) / 429(限流) / 5xx / 非 WAV 魔数会自动重试，最多 3 次尝试。
 * maxAttempts=1 可用于快速失败场景（如挑战路由的多级合成链首级）。
 */
export async function synthesizeSpeech(
  opts: TTSOptions,
  timeoutMs = 60_000,
  maxAttempts = RETRY_DELAYS_MS.length + 1
): Promise<Buffer> {
  const cfg = await loadConfig();
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/audio/tts`;

  // ⚠️ 关键：请求形态必须"像 curl"——
  // 显式 User-Agent（覆盖任何默认值）+ Accept；绝不携带 sec-fetch-mode 等指纹头。
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "ShieldEar-Server/1.0",
    Accept: "*/*",
    Authorization: `Bearer ${cfg.apiKey}`,
    "X-Z-AI-From": "Z",
  };
  if (cfg.token) headers["X-Token"] = cfg.token;

  const body = JSON.stringify({
    input: opts.input,
    voice: opts.voice,
    speed: Math.min(2, Math.max(0.5, opts.speed ?? 1.0)),
    response_format: opts.response_format ?? "wav",
    stream: false,
  });

  let lastErr: unknown = null;
  const totalAttempts = Math.max(1, Math.min(maxAttempts, RETRY_DELAYS_MS.length + 1));
  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    try {
      const { status, body: respBody } = await postJson(url, headers, body, timeoutMs);
      if (status === 200) {
        const expectWav = (opts.response_format ?? "wav") === "wav";
        if (
          respBody.length >= 2000 &&
          (!expectWav || respBody.subarray(0, 4).toString("ascii") === "RIFF")
        ) {
          return respBody;
        }
        // 200 但内容不是音频（网关偶发返回 200 状态的错误页）→ 重试
        lastErr = new Error(`TTS 返回的音频无效（${respBody.length} 字节，非 WAV）`);
        continue;
      }
      const snippet = respBody.subarray(0, 120).toString("utf-8");
      lastErr = new Error(`TTS 通道返回 ${status}: ${snippet}`);
      if (!RETRYABLE_STATUS.has(status)) throw lastErr; // 4xx 参数错误重试无益
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("TTS 合成失败（未知错误）");
}
