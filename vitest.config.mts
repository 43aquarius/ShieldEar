import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * 声盾 ShieldEar — 单元测试配置（v1.3.13 引入）
 *
 * 测试对象：引擎（src/lib/engine）、WAV 编解码（src/lib/audio）等纯 TS 同构模块。
 * 不测浏览器专属路径（AudioContext/base64 等，由 E2E 断网回归覆盖）。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // 引擎微基准断言（RTF<1）在 CI 低配 runner 上可能抖动，放宽默认超时
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      // v1.3.15 工程治理：__dirname 为 CJS 全局，vitest 5 起在 .mts 弃用并告警；
      // import.meta.dirname 是 ESM 原生等价物（Node 20.11+，CI 与本机 Node 24 均满足）
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
