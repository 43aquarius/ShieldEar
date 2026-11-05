#!/usr/bin/env python3
"""make-portable-zip.py — 组装最终交付 zip（UTF-8 flag + DEFLATED）· v1.3.5
产物: /home/z/my-project/download/ShieldEar-v1.3.5-portable.zip
"""
import os, zipfile

SRC = "/tmp/package-build/ShieldEar"
OUT = "/home/z/my-project/download/ShieldEar-v1.3.5-portable.zip"
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
