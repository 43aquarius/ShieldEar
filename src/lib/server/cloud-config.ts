/**
 * 云端合成通道运行时配置（v1.3.3 融合版；v1.3.5 新增纯离线发行锁）
 * ────────────────────────────────────────────────
 * 环境约定（沿用 v1.3.2 的 SHIELD_TTS_ONLINE，run-shield 启动器同款）：
 *   SHIELD_TTS_ONLINE=1 → 云端通道开启（四级合成链完整）；
 *   未设置 / 其他值  → 纯离线（默认安全值：Tier1/2 云端通道零尝试零等待零联网）。
 *
 * 运行时开关（v1.3.3 新增）：
 *   GET/POST /api/config/cloud — 界面即时切换，无需重启；重启回落环境默认。
 *
 * 纯离线发行锁（v1.3.5 新增，面向公开发布的便携包）：
 *   SHIELD_RELEASE_OFFLINE=1 → 云端通道永久锁死为关闭：
 *   运行时切换接口失效（POST 返回 403）、前端编译期徽章化、
 *   合成链只合本地 espeak-ng，包内不存在任何可触发的联网路径。
 */

/** 纯离线发行锁：构建发布包时注入（boot.js 同步注入，双保险） */
export function isReleaseOfflineBuild(): boolean {
  return process.env.SHIELD_RELEASE_OFFLINE === "1";
}

/** 环境级默认：SHIELD_TTS_ONLINE=1 时云端开启，否则纯离线（发行锁下恒关） */
export function envCloudDefault(): boolean {
  if (isReleaseOfflineBuild()) return false;
  return process.env.SHIELD_TTS_ONLINE === "1";
}

/**
 * 运行时开关（globalThis 单例；Next.js dev 模式下各路由独立打包，
 * 模块级变量不共享，必须挂到全局；重启回落到环境默认值）
 */
const G = globalThis as unknown as { __shieldEarCloudEnabled?: boolean | null };

/** 当前云端通道是否开启（发行锁下恒 false；运行时值 > 环境默认） */
export function isCloudEnabled(): boolean {
  if (isReleaseOfflineBuild()) return false;
  const v = G.__shieldEarCloudEnabled;
  return v !== undefined && v !== null ? v : envCloudDefault();
}

/** 环境是否为离线交付模式（只读事实：环境默认未开启云端，不受运行时开关影响） */
export function isOfflineMode(): boolean {
  return !envCloudDefault();
}

/** 运行时切换云端通道；发行锁下拒绝切换（返回 false 表示被拒）；显式传 null 表示「恢复环境默认值」 */
export function setCloudEnabled(enabled: boolean | null): boolean {
  if (isReleaseOfflineBuild()) return false;
  G.__shieldEarCloudEnabled = enabled;
  return true;
}

/** 供响应展示的通道说明 */
export function cloudChannelSummary(): string {
  if (isReleaseOfflineBuild()) {
    return "纯离线发行版：仅使用本地 espeak-ng 合成（零联网、零尝试、零等待），本包不含云端合成通道";
  }
  return isCloudEnabled()
    ? "云端通道开启：合成链按 z-ai 网关 → Edge 神经 TTS → 本地 espeak-ng → 预置样本 四级自动降级"
    : "云端通道关闭：仅使用本地 espeak-ng 合成（零联网、零尝试、零等待）；如需对比云端商用 TTS 效果可在界面开启";
}
