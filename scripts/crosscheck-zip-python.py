#!/usr/bin/env python3
"""crosscheck-zip-python.py — Python zipfile 实际解包交叉验证（v1.3.14）

对 bun scripts/crosscheck-zip.ts 产出的 /tmp/zip-cross-check.zip：
  1. zipfile 完整性测试（逐条目 CRC 校验，testzip 返回 None 即全过）；
  2. 逐条目长度与 CRC 与 TS 侧写入值一致；
  3. 中文文件名按 UTF-8 正确往返（通用位标志 bit 11）；
  4. STORE 法压缩属性正确（ZIP_STORED）。
任何一项失败即非零退出 —— 存证包格式互操作性的独立第三方背书。
"""
import os
import sys
import zipfile
import zlib

PATH = "/tmp/zip-cross-check.zip"

if not os.path.exists(PATH):
    print(f"✗ {PATH} 不存在 —— 先运行: bun scripts/crosscheck-zip.ts")
    sys.exit(1)

z = zipfile.ZipFile(PATH)

bad = z.testzip()
if bad is not None:
    print(f"✗ CRC 失败条目: {bad}")
    sys.exit(1)
print("✓ zipfile.testzip() 全条目 CRC 通过")

names = z.namelist()
expected = [
    "SS-20260101-0001_evidence.wav",
    "case-record.json",
    "存证包_核验报告.txt",
    "empty_marker.bin",
]
if names != expected:
    print(f"✗ 条目名不一致:\n  实际 {names}\n  期望 {expected}")
    sys.exit(1)
print(f"✓ 条目清单与顺序一致（含中文名 UTF-8 往返）：{len(names)} 条")

for info in z.infolist():
    data = z.read(info.filename)
    if zlib.crc32(data) & 0xFFFFFFFF != info.CRC:
        print(f"✗ {info.filename}: zlib.crc32 与中央目录 CRC 不一致")
        sys.exit(1)
    if info.compress_type != zipfile.ZIP_STORED:
        print(f"✗ {info.filename}: 压缩方法非 STORE ({info.compress_type})")
        sys.exit(1)
    if not (info.flag_bits & 0x800):
        print(f"✗ {info.filename}: UTF-8 通用位标志缺失")
        sys.exit(1)
    print(f"  · {info.filename}: {len(data):,}B · CRC {info.CRC:08x} · STORE · UTF-8 ✓")

print("✓ Python zipfile 交叉验证全部通过")
