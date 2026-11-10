/**
 * 极简 ZIP 构建器测试（v1.3.14）
 * 存证包是平台对外交付的取证产物，其字节格式的正确性此前仅由
 * 「Python zipfile 能打开」的线下一次性验证背书 —— 现钉入单测：
 *   · CRC-32 对拍 IEEE 802.3 公开校验向量（权威锚点）；
 *   · 结构断言：EOCD / 中央目录 / 本地头的签名、偏移、计数字段自洽；
 *   · 迷你解析器往返：按中央目录定位本地头 → 抽取数据 → 与原始字节
 *     逐位一致（等价于解压器视角的互操作性）；
 *   · 边界：中文文件名（UTF-8 标志位）、空条目、共享 ArrayBuffer 的
 *     Uint8Array 视图、超长条目名拒绝。
 * 线下另以 Python zipfile 实际解包交叉验证（见 worklog v1.3.14 实录）。
 */
import { describe, it, expect } from "vitest";
import { crc32, buildZip, type ZipEntry } from "../zip";

const enc = new TextEncoder();

function bytesOf(s: string): Uint8Array {
  return enc.encode(s);
}

describe("crc32（IEEE 802.3 查表实现）", () => {
  it("公开校验向量对拍", () => {
    expect(crc32(bytesOf("123456789"))).toBe(0xcbf43926); // CRC-32 规范校验值
    expect(crc32(bytesOf("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("空输入 → 0；无符号 32 位返回", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    // 全 0xFF 输入的结果必须落在 [0, 2^32)（防符号位泄漏）
    const v = crc32(new Uint8Array(1024).fill(0xff));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(2 ** 32);
  });

  it("同一字节序列确定性一致", () => {
    const b = new Uint8Array([0, 1, 2, 3, 254, 255]);
    expect(crc32(b)).toBe(crc32(b));
  });
});

interface ParsedEntry {
  name: string;
  crc: number;
  size: number;
  localOffset: number;
  method: number;
  flags: number;
  versionNeeded: number;
}

/** 迷你 ZIP 解析器：EOCD → 中央目录 → 逐条目（等价于解压器读取路径） */
function parseZip(zip: Buffer): { entries: ParsedEntry[]; eocd: ReturnType<typeof readEocd> } {
  const eocd = readEocd(zip);
  const entries: ParsedEntry[] = [];
  let off = eocd.cdOffset;
  for (let i = 0; i < eocd.count; i++) {
    expect(zip.readUInt32LE(off)).toBe(0x02014b50); // 中央目录签名
    entries.push({
      versionNeeded: zip.readUInt16LE(off + 6),
      flags: zip.readUInt16LE(off + 8),
      method: zip.readUInt16LE(off + 10),
      crc: zip.readUInt32LE(off + 16),
      size: zip.readUInt32LE(off + 24),
      localOffset: zip.readUInt32LE(off + 42),
      name: zip.subarray(off + 46, off + 46 + zip.readUInt16LE(off + 28)).toString("utf8"),
    });
    off += 46 + zip.readUInt16LE(off + 28);
  }
  // 中央目录恰消耗完（无空洞、无越界）
  expect(off).toBe(eocd.cdOffset + eocd.cdSize);
  return { entries, eocd };
}

function readEocd(zip: Buffer) {
  const off = zip.length - 22;
  expect(zip.readUInt32LE(off)).toBe(0x06054b50); // EOCD 签名
  return {
    count: zip.readUInt16LE(off + 10),
    cdSize: zip.readUInt32LE(off + 12),
    cdOffset: zip.readUInt32LE(off + 16),
  };
}

/** 按本地头抽取条目数据（解压器路径） */
function extract(zip: Buffer, e: ParsedEntry): Uint8Array {
  expect(zip.readUInt32LE(e.localOffset)).toBe(0x04034b50); // 本地头签名
  const nameLen = zip.readUInt16LE(e.localOffset + 26);
  const dataStart = e.localOffset + 30 + nameLen;
  return zip.subarray(dataStart, dataStart + e.size);
}

describe("buildZip 结构与往返", () => {
  const SAMPLES: ZipEntry[] = [
    { name: "case-record.json", data: bytesOf(JSON.stringify({ caseNo: "SS-20260101-0001", ok: true })) },
    { name: "SS-20260101-0001_evidence.wav", data: new Uint8Array(60000).map((_, i) => (i * 7 + (i % 251)) & 0xff) },
    { name: "存证包_核验报告.txt", data: bytesOf("声盾 ShieldEar 存证包核验报告\n") },
    { name: "empty_marker.bin", data: new Uint8Array(0) },
  ];

  it("总长度 = Σ(30+名+数据) + Σ(46+名) + 22（无隐藏字节）", () => {
    const zip = buildZip(SAMPLES);
    const expected =
      SAMPLES.reduce((s, e) => s + 30 + Buffer.byteLength(e.name, "utf8") + e.data.length, 0) +
      SAMPLES.reduce((s, e) => s + 46 + Buffer.byteLength(e.name, "utf8"), 0) +
      22;
    expect(zip.length).toBe(expected);
  });

  it("EOCD 计数 / 中央目录偏移自洽", () => {
    const zip = buildZip(SAMPLES);
    const { eocd } = parseZip(zip);
    expect(eocd.count).toBe(SAMPLES.length);
    expect(eocd.cdOffset).toBe(
      SAMPLES.reduce((s, e) => s + 30 + Buffer.byteLength(e.name, "utf8") + e.data.length, 0)
    );
  });

  it("中央目录逐条目：名称 / CRC / 尺寸 / STORE 方法 / UTF-8 标志 / 版本号", () => {
    const zip = buildZip(SAMPLES);
    const { entries } = parseZip(zip);
    expect(entries.map((e) => e.name)).toEqual(SAMPLES.map((e) => e.name));
    for (let i = 0; i < entries.length; i++) {
      expect(entries[i].crc).toBe(crc32(SAMPLES[i].data));
      expect(entries[i].size).toBe(SAMPLES[i].data.length);
      expect(entries[i].method).toBe(0); // STORE
      expect(entries[i].flags & 0x0800).toBe(0x0800); // UTF-8 名称位
      expect(entries[i].versionNeeded).toBe(20);
    }
  });

  it("解压器路径往返：中央目录定位 → 本地头抽取 → 逐位一致", () => {
    const zip = buildZip(SAMPLES);
    const { entries } = parseZip(zip);
    for (let i = 0; i < entries.length; i++) {
      const got = extract(zip, entries[i]);
      expect(Buffer.from(got).equals(Buffer.from(SAMPLES[i].data))).toBe(true);
    }
  });

  it("本地头同样声明 UTF-8 标志与 STORE", () => {
    const zip = buildZip([{ name: "中文名.wav", data: bytesOf("x") }]);
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800);
    expect(zip.readUInt16LE(8)).toBe(0);
  });

  it("共享 ArrayBuffer 的 Uint8Array 视图（byteOffset>0）按视图内容打包", () => {
    const big = new Uint8Array(64);
    for (let i = 0; i < 64; i++) big[i] = i;
    const view = big.subarray(16, 48); // byteOffset=16, length=32
    const zip = buildZip([{ name: "view.bin", data: view }]);
    const { entries } = parseZip(zip);
    expect(entries[0].size).toBe(32);
    expect(Buffer.from(extract(zip, entries[0])).equals(Buffer.from(view))).toBe(true);
    // CRC 也是视图内容的（而非整段 64 字节）
    expect(entries[0].crc).toBe(crc32(view));
  });

  it("条目名超 0xFFFF 字节 → 拒绝（规范上限）", () => {
    expect(() => buildZip([{ name: "x".repeat(0x10000), data: bytesOf("y") }])).toThrow(/过长/);
  });

  it("空条目列表 → 仅 EOCD 的合法空包", () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    const { eocd } = parseZip(zip);
    expect(eocd.count).toBe(0);
  });
});
