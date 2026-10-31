/**
 * 云端合成通道运行时配置（v1.3.3 融合版）
 * ────────────────────────────────────────────────
 * 环境约定（沿用 v1.3.2 的 SHIELD_TTS_ONLINE，run-shield 启动器同款）：
 *   SHIELD_TTS_ONLINE=1 → 云端通道开启（四级合成链完整：z-ai → Edge → espeak → 预置）
 *   未设置 / 其他值  → 纯离线（默认安全值：Tier1/2 云端通道零尝试零等待零联网，
 *                       合成直达本地 espeak-ng 真合成）
 *
 * 运行时开关（v1.3.3 新增）：
 *   GET/POST /api/config/cloud — 界面即时切换，无需重启；
 *   globalThis 单例（Next.js dev 各路由独立打包也能共享状态）；
 *   重启自动回落到环境默认值（离线交付的安全默认不变）。
 */

/** 环境级默认：SHIELD_TTS_ONLINE=1 时云端开启，否则纯离线 */
export function envCloudDefault(): boolean {
  return process.env.SHIELD_TTS_ONLINE === "1";
}

/**
 * 运行时开关（globalThis 单例；Next.js dev 模式下各路由独立打包，
 * 模块级变量不共享，必须挂到全局；重启回落到环境默认值）
 */
const G = globalThis as unknown as { __shieldEarCloudEnabled?: boolean | null };

/** 当前云端通道是否开启（运行时值 > 环境默认） */
export function isCloudEnabled(): boolean {
  const v = G.__shieldEarCloudEnabled;
  return v !== undefined && v !== null ? v : envCloudDefault();
}

/** 环境是否为离线交付模式（只读事实：环境默认未开启云端，不受运行时开关影响） */
export function isOfflineMode(): boolean {
  return !envCloudDefault();
}

/** 运行时切换云端通道；显式传 null 表示「恢复环境默认值」 */
export function setCloudEnabled(enabled: boolean | null): void {
  G.__shieldEarCloudEnabled = enabled;
}

/** 供响应展示的通道说明 */
export function cloudChannelSummary(): string {
  return isCloudEnabled()
    ? "云端通道开启：合成链按 z-ai 网关 → Edge 神经 TTS → 本地 espeak-ng → 预置样本 四级自动降级"
    : "云端通道关闭：仅使用本地 espeak-ng 合成（零联网、零尝试、零等待）；如需对比云端商用 TTS 效果可在界面开启";
}
