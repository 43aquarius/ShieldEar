/**
 * 声盾 — 案件编号校验与证据路径容器化解析（纯函数模块，v1.3.14）
 * ──────────────────────────────────────────────────────────────────
 * 背景（安全审计发现）：caseNo 来自 URL 路径参数，历史实现将其直接
 * 拼入 evidencePath（path.join(evidence/, `${caseNo}_evidence.wav`)）。
 * /api/evidence/[caseNo] 在未查库前先行读文件，经 `%2E%2E%2F` 编码的
 * 路径段可逃逸 evidence/ 目录，读取工作目录外任意 *_evidence.wav /
 * *_source.bin 后缀的文件（本地单机部署下危害有限，但对一个以「取证
 * 存证链可信」立身的平台属于必须清零的缺陷类别）。
 *
 * 本模块提供两道相互独立的防线：
 *   1. 格式闸 isValidCaseNo：caseNo 必须形如 SS-YYYYMMDD-XXXX —— 这是
 *      nextCaseNo() 的唯一产出格式，路由层据此 400 早退；
 *   2. 容器闸 resolveInsideDir：解析绝对路径并断言仍在基目录内。即使
 *      未来新增调用方绕过格式闸传入恶意输入，物理上也无路可逃。
 * 两者单独存在即可阻断本缺陷，叠加使用满足纵深防御。
 */
import path from "path";

/** 服务端 nextCaseNo() 的唯一产出格式：SS-YYYYMMDD-XXXX */
export const CASE_NO_RE = /^SS-\d{8}-\d{4}$/;

/** 格式闸：仅接受服务端生成的标准案件编号（类型收窄便于路由层直接使用） */
export function isValidCaseNo(caseNo: unknown): caseNo is string {
  return typeof caseNo === "string" && CASE_NO_RE.test(caseNo);
}

/**
 * 容器闸：把 segments 拼接到 baseDir 下并解析为绝对路径，若结果逃逸出
 * baseDir 则抛错（路径遍历防御）。允许结果恰为 baseDir 本身（由调用方
 * 的文件后缀保证实际不会发生），拒绝一切越界解析。
 */
export function resolveInsideDir(baseDir: string, ...segments: string[]): string {
  const base = path.resolve(baseDir);
  const joined = path.resolve(base, ...segments);
  if (joined !== base && !joined.startsWith(base + path.sep)) {
    throw new Error(`路径逃逸被拦截：${segments.join("/").slice(0, 60)}`);
  }
  return joined;
}
