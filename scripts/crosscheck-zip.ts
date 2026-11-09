/**
 * crosscheck-zip.ts — 用真实 buildZip 构建代表性存证包 → /tmp/zip-cross-check.zip
 * 供 scripts/crosscheck-zip-python.py 以 Python zipfile 实际解包交叉验证
 * （v1.3.14：互操作性从「一次性人工验证」固化为可复跑脚本）。
 * 运行：bun scripts/crosscheck-zip.ts && python3 scripts/crosscheck-zip-python.py
 */
import { buildZip, crc32 } from "../src/lib/server/zip";
import { writeFileSync } from "fs";

const enc = new TextEncoder();

// 模拟真实存证包的条目构成（含中文文件名、大二进制、空条目）
const wav = new Uint8Array(80_000);
for (let i = 0; i < wav.length; i++) wav[i] = Math.round(0x7fff * Math.sin(i / 100) * ((i % 32000) / 32000 - 0.5)) & 0xff;

const entries = [
  { name: "SS-20260101-0001_evidence.wav", data: wav },
  {
    name: "case-record.json",
    data: enc.encode(
      JSON.stringify(
        { caseNo: "SS-20260101-0001", channel: "wideband", engineVersion: "v2.0.0-calibrated", overallRisk: "CRITICAL" },
        null,
        2
      )
    ),
  },
  { name: "存证包_核验报告.txt", data: enc.encode("声盾 ShieldEar — 中文文件名与内容核验\n") },
  { name: "empty_marker.bin", data: new Uint8Array(0) },
];

const zip = buildZip(entries);
writeFileSync("/tmp/zip-cross-check.zip", zip);
console.log(`written /tmp/zip-cross-check.zip (${zip.length}B, ${entries.length} entries)`);
console.log("crc32(canonical '123456789') =", crc32(enc.encode("123456789")).toString(16), "(期望 cbf43926)");
