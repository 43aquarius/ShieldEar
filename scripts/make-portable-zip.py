#!/usr/bin/env python3
"""make-portable-zip.py — 组装最终交付 zip（UTF-8 flag + DEFLATED）· v1.3.11
产物: /home/z/my-project/download/ShieldEar-v1.3.11-portable.zip
"""
import os, subprocess, sys, zipfile

SRC = "/tmp/package-build/ShieldEar"
OUT = "/home/z/my-project/download/ShieldEar-v1.3.11-portable.zip"

# fail-fast（v1.3.6）：交付树禁止软链 —— os.walk 会静默丢弃目录软链，
# 导致 Windows 解压后模块缺失（v1.3.5 Prisma 外部依赖事故根因）
links = subprocess.run(["find", SRC, "-type", "l"], capture_output=True, text=True).stdout.strip()
if links:
    print("✗ 交付树存在软链（zip 将丢失，运行时缺模块）:")
    print(links)
    sys.exit(1)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
if os.path.exists(OUT):
    os.remove(OUT)

n = 0
with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, dirs, files in os.walk(SRC):
        dirs.sort()
        for f in sorted(files):
            full = os.path.join(root, f)
            rel = os.path.relpath(full, os.path.dirname(SRC))  # 保留 ShieldEar/ 顶层目录
            z.write(full, rel)
            n += 1

sz = os.path.getsize(OUT)
print(f"✓ {OUT}")
print(f"  文件数: {n} · 大小: {sz/1048576:.1f} MB")
