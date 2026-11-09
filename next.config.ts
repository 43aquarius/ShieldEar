import type { NextConfig } from "next";

/**
 * 声盾 — HTTP 安全响应头（v1.3.14）
 * 本地单机部署不等于可以免设基础防线：鉴伪平台的判决与证据链页面
 * 不应被 iframe 嵌套（点击劫持伪造「核验通过」假象）、响应不应被
 * MIME 嗅探、页面不应向任何外部域发起连接（离线声明的传输层对应物）。
 *
 * CSP 口径（保守起见均放行同源 + 必要的 blob:/data:）：
 *   · script-src 'unsafe-inline'：Next.js 生产构建注入内联 hydration 脚本
 *     （self.__next_f），不可去除；仍阻断一切外部脚本加载
 *   · media-src blob:：判决回放/试听使用 URL.createObjectURL 的 blob 音频
 *   · 开发模式额外放行 'unsafe-eval'（React Fast Refresh / HMR 依赖）
 *   · connect-src 'self'：前端仅请求本机 API —— 与「全程零外连」离线
 *     声明互为印证（违反即被浏览器拦截，相当于给离线声明上了强制执行层）
 */
const isDev = process.env.NODE_ENV === "development";

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  // 实时鉴听需要本页麦克风；其余能力一律关闭
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
