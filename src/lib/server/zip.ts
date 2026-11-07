/**
 * 声盾 — 极简 ZIP 构建器（v1.3.9，零外部依赖）
 * ────────────────────────────────────────────────────────────
 * 用途：单案例「存证包」离线导出（证据音频 + 原始来源 + 案例记录 +
 *       完整性核验报告 + SHA-256 清单）。
 * 实现：STORE（仅存储，不压缩）——音频本身不可压缩，JSON 文本量小，
 *       换取实现最小化与 100% 可解包性（Windows 资源管理器 / unzip /
 *       7-Zip / Python zipfile 均可直接打开）。
 * 规范：PKWARE APPNOTE 6.3.x（本地文件头 + 中央目录 + EOCD），
 *       文件名 UTF-8（通用位标志 bit 11）。
 */

/** CRC-32（IEEE 802.3，查表法） */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** 当前时间的 DOS 时间戳（2 字节 time + 2 字节 date） */
function dosDateTime(): { time: number; date: number } {
  const d = new Date();
  const time =
    ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/** 构建 ZIP（STORE 法）。条目名使用正斜杠分隔（ZIP 规范路径分隔符）。 */
export function buildZip(entries: ZipEntry[]): Buffer {
  const { time, date } = dosDateTime();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    if (nameBuf.length > 0xffff) throw new Error(`ZIP 条目名过长: ${e.name.slice(0, 40)}…`);
    const crc = crc32(e.data);
    const size = e.data.length;

    // 本地文件头（30 字节 + 名）
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // signature PK\x03\x04
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0x0800, 6); // flags: UTF-8 名称
    lfh.writeUInt16LE(0, 8); // method: STORE
    lfh.writeUInt16LE(time, 10);
    lfh.writeUInt16LE(date, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(size, 18); // compressed
    lfh.writeUInt32LE(size, 22); // uncompressed
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra len
    locals.push(lfh, nameBuf, Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength));

    // 中央目录头（46 字节 + 名）
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // signature PK\x01\x02
    cdh.writeUInt16LE(0x0314, 4); // version made by (UNIX/ZIP 2.0 → 外部属性可带权限)
    cdh.writeUInt16LE(20, 6); // version needed
    cdh.writeUInt16LE(0x0800, 8); // flags: UTF-8
    cdh.writeUInt16LE(0, 10); // method STORE
    cdh.writeUInt16LE(time, 12);
    cdh.writeUInt16LE(date, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(size, 20);
    cdh.writeUInt32LE(size, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra
    cdh.writeUInt16LE(0, 32); // comment
    cdh.writeUInt16LE(0, 34); // disk start
    cdh.writeUInt16LE(0, 36); // internal attrs
    cdh.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs (UNIX -rw-r--r--)，>>>0 防 int32 溢出为负
    cdh.writeUInt32LE(offset, 42); // 本地头偏移
    centrals.push(cdh, nameBuf);

    offset += 30 + nameBuf.length + size;
  }

  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature PK\x05\x06
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // cd start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16); // cd offset
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...locals, cdBuf, eocd]);
}
