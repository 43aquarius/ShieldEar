/**
 * 案件编号格式闸 + 证据路径容器闸测试（v1.3.14）
 * 背景缺陷：/api/evidence/[caseNo] 未查库先读文件，未校验的 caseNo
 * 直接拼进证据路径 —— 本文件把该缺陷的攻击面逐一钉死：
 *   · 格式闸：遍历载荷（../、..%2F、反斜杠、NUL、拼在合法编号后的路径段）
 *     一律拒绝，仅放行服务端 nextCaseNo() 的唯一产出格式；
 *   · 容器闸：即使绕过格式闸（假设未来调用方疏漏），resolveInsideDir
 *     对一切逃逸解析抛错，物理上无路可走。
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { CASE_NO_RE, isValidCaseNo, resolveInsideDir } from "../case-no";

const BASE = path.resolve("/srv/shieldear/evidence");

describe("isValidCaseNo 格式闸", () => {
  it("服务端产出格式 SS-YYYYMMDD-XXXX 全部放行", () => {
    expect(isValidCaseNo("SS-20260101-0001")).toBe(true);
    expect(isValidCaseNo("SS-20261109-9999")).toBe(true);
    expect(isValidCaseNo("SS-19991231-0000")).toBe(true);
  });

  it("路径遍历载荷全部拒绝（本缺陷的攻击面）", () => {
    const payloads = [
      "../../etc/passwd",
      "..%2F..%2Fetc%2Fpasswd",
      "..", // 恰为目录跳段
      "../..",
      "..\\..\\windows\\system32",
      "SS-20260101-0001/../../secret", // 合法编号后拼路径段
      "SS-20260101-0001\\..\\..\\secret",
      "SS-20260101-0001\u0000.wav", // NUL 截断攻击
      "/absolute/path",
      "C:\\absolute\\path",
    ];
    for (const p of payloads) expect(isValidCaseNo(p), `payload: ${JSON.stringify(p)}`).toBe(false);
  });

  it("形似但不合规的编号拒绝（位数 / 大小写 / 分隔符 / 前后缀）", () => {
    const bad = [
      "ss-20260101-0001", // 小写
      "SS-2026011-0001", // 日期 7 位
      "SS-202601011-0001", // 日期 9 位
      "SS-20260101-001", // 序号 3 位
      "SS-20260101-00001", // 序号 5 位
      "SS-2026/01/01-0001",
      "SS 20260101 0001",
      "SS-20260101-0001 ", // 尾随空格
      " SS-20260101-0001",
      "",
      "SS-20260101-0001\n",
    ];
    for (const b of bad) expect(isValidCaseNo(b), `payload: ${JSON.stringify(b)}`).toBe(false);
  });

  it("非字符串输入拒绝（类型闸）", () => {
    expect(isValidCaseNo(undefined)).toBe(false);
    expect(isValidCaseNo(null)).toBe(false);
    expect(isValidCaseNo(123)).toBe(false);
    expect(isValidCaseNo({ caseNo: "SS-20260101-0001" })).toBe(false);
    expect(isValidCaseNo(["SS-20260101-0001"])).toBe(false);
  });

  it("CASE_NO_RE 与校验函数行为一致（单一事实源）", () => {
    for (const s of ["SS-20260101-0001", "bad", "SS-2026-01"]) {
      expect(CASE_NO_RE.test(s)).toBe(isValidCaseNo(s));
    }
  });
});

describe("resolveInsideDir 容器闸", () => {
  it("正常文件名解析为基目录内的绝对路径", () => {
    const p = resolveInsideDir(BASE, "SS-20260101-0001_evidence.wav");
    expect(p).toBe(path.join(BASE, "SS-20260101-0001_evidence.wav"));
    expect(p.startsWith(BASE + path.sep)).toBe(true);
  });

  it("基目录内嵌套路径放行（容器内自由）", () => {
    const p = resolveInsideDir(BASE, "sub", "SS-20260101-0001.wav");
    expect(p).toBe(path.join(BASE, "sub", "SS-20260101-0001.wav"));
  });

  it("../ 逃逸一律抛错", () => {
    expect(() => resolveInsideDir(BASE, "../x.wav")).toThrow(/路径逃逸/);
    expect(() => resolveInsideDir(BASE, "../../etc/passwd_evidence.wav")).toThrow(/路径逃逸/);
    expect(() => resolveInsideDir(BASE, "ok/../../escape.wav")).toThrow(/路径逃逸/);
  });

  it("绝对路径段接管解析 → 抛错（path.resolve 语义下的逃逸）", () => {
    expect(() => resolveInsideDir(BASE, "/etc/passwd")).toThrow(/路径逃逸/);
    expect(() => resolveInsideDir(BASE, "x", "/etc/passwd")).toThrow(/路径逃逸/);
  });

  it("纯目录名段（无文件）恰解析为基目录本身 → 放行（文档化行为）", () => {
    expect(resolveInsideDir(BASE, ".")).toBe(BASE);
  });

  it("相对化基目录输入同样安全（内部先行 resolve）", () => {
    const relBase = path.join(process.cwd(), "evidence");
    const p = resolveInsideDir(relBase, "SS-20260101-0001_source.bin");
    expect(p.startsWith(path.resolve(relBase) + path.sep)).toBe(true);
    expect(() => resolveInsideDir(relBase, "../escape.bin")).toThrow(/路径逃逸/);
  });
});
