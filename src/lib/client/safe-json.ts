/**
 * 声盾 — 前端统一 JSON 请求工具（v1.3.5）
 * ────────────────────────────────────────────────
 * 背景：服务端模块加载失败（如 Prisma 引擎缺失）时，Next.js 返回
 * 纯文本 "Internal Server Error"（HTTP 500）。旧代码 `await resp.json()`
 * 在 resp.ok 检查之前执行，遇到纯文本体直接抛出
 * `Unexpected token 'I', "Internal S"... is not valid JSON`，
 * 用户看到的错误完全无法定位。
 *
 * 本工具统一兜底：
 *   1. 先拿文本，尝试 JSON.parse（失败不抛）；
 *   2. resp.ok 为假时优先取 body.error，其次截断纯文本，最后 HTTP 状态码；
 *   3. 对 500 级别错误追加「服务端可能未完全启动」的人话提示。
 */

export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch {
    throw new Error("网络请求失败：无法连接本地服务，请确认声盾服务已启动");
  }

  const text = await resp.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null; // 纯文本错误体（如 "Internal Server Error"）
    }
  }

  if (!resp.ok) {
    const body = data as { error?: string } | null;
    let msg = body?.error ?? (text ? text.slice(0, 160) : `HTTP ${resp.status}`);
    if (resp.status >= 500) {
      msg += "（服务端异常：若刚启动请等待数秒后重试；若持续出现请查看启动窗口的错误提示）";
    }
    throw new Error(msg);
  }

  if (data === null) {
    throw new Error("服务端返回了无法解析的响应");
  }
  return data as T;
}
