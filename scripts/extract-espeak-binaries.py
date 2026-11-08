#!/usr/bin/env python3
"""extract-espeak-binaries.py — 从 v1.3.9 Release zip Range 抽取 Windows espeak 二进制

fetch-zip-members.py 对 CDN HEAD 返回 content-length:0 无策，此处：
  1. 用 curl -sL 拿签名直链（跟随 302）
  2. 已知总长（API asset.size = 77877484）
  3. Range 拉尾部 2MB → EOCD + 中央目录 → 定位成员
  4. Range 拉成员局部头+压缩数据 → 解压落盘 /tmp/msi-out/
"""
import struct
import subprocess
import sys
import urllib.request
import zlib
import os

URL_PAGE = "https://github.com/43aquarius/ShieldEar/releases/download/v1.3.9/ShieldEar-v1.3.9-portable.zip"
TOTAL = 77877484
WANT = ["ShieldEar/espeak-ng/espeak-ng.exe", "ShieldEar/espeak-ng/libespeak_ng.dll"]
OUT_DIR = "/tmp/msi-out"
os.makedirs(OUT_DIR, exist_ok=True)

# ── 1. 签名直链（curl 手动跟随，输出最终 URL） ──
signed = subprocess.run(
    ["curl", "-sL", "-o", "/dev/null", "-w", "%{url_effective}", "--max-time", "60", URL_PAGE],
    capture_output=True, text=True, timeout=90,
).stdout.strip()
assert signed.startswith("https://"), f"直链获取失败: {signed[:120]}"
print(f"[1] 签名直链 OK（{len(signed)} 字符）")

def fetch(start, end, timeout=120):
    req = urllib.request.Request(signed, headers={"Range": f"bytes={start}-{end}", "User-Agent": "x"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    assert len(data) == end - start + 1, f"Range 短读 {start}-{end}: got {len(data)}"
    return data

# ── 2. 尾部 2MB → EOCD + 中央目录 ──
TAIL = 2 * 1024 * 1024
tail = fetch(TOTAL - TAIL, TOTAL - 1)
eocd = tail.rfind(b"PK\x05\x06")
assert eocd >= 0, "无 EOCD"
_, _, _, _, n_total, cd_size, cd_off, _ = struct.unpack("<IHHHHIIH", tail[eocd:eocd + 22])
print(f"[2] 成员 {n_total} · CD {cd_size} B")
cd = tail[eocd - cd_size:eocd]

# ── 3. 解析中央目录 ──
entries = {}
p = 0
while p + 46 <= len(cd):
    if cd[p:p + 4] != b"PK\x01\x02":
        break
    # 46 字节固定头（含 4 字节签名 PK\x01\x02）
    (sig, vmade, vneed, flags, method, mtime, mdate, crc, csize, usize,
     nlen, elen, clen, disk, iattr, eattr, lho) = struct.unpack("<IHHHHHHIIIHHHHHII", cd[p:p + 46])
    name = cd[p + 46:p + 46 + nlen].decode("utf-8", "replace")
    entries[name] = dict(method=method, crc=crc, csize=csize, usize=usize, lho=lho)
    p += 46 + nlen + elen + clen
print(f"[3] 目录解析 {len(entries)} 条")

def crc32(b):
    return zlib.crc32(b) & 0xFFFFFFFF

# ── 4. 抽取目标成员 ──
for name in WANT:
    e = entries.get(name)
    assert e, f"zip 无成员 {name}"
    # 局部头：30 字节 + 文件名 + 扩展字段 → 数据区
    lh = fetch(e["lho"], e["lho"] + 29)
    assert lh[:4] == b"PK\x03\x04", "局部头魔数不符"
    nlen2, elen2 = struct.unpack("<HH", lh[26:30])
    data_start = e["lho"] + 30 + nlen2 + elen2
    raw = fetch(data_start, data_start + e["csize"] - 1, timeout=300)
    if e["method"] == 0:
        content = raw
    elif e["method"] == 8:
        content = zlib.decompress(raw, -15)
    else:
        raise RuntimeError(f"不支持的压缩方法 {e['method']}")
    assert len(content) == e["usize"], f"{name}: 解压尺寸不符"
    got_crc = crc32(content)
    assert got_crc == e["crc"], f"{name}: CRC 不符 {got_crc:08x} != {e['crc']:08x}"
    out = os.path.join(OUT_DIR, os.path.basename(name))
    with open(out, "wb") as f:
        f.write(content)
    os.chmod(out, 0o755)
    print(f"[4] ✓ {name} → {out} · {len(content):,} B · CRC {got_crc:08x}")

print("[5] 完成（espeak-ng-data 用系统 1.52.0 数据，与 MSI 逐字节等价 —— 见 rebuild-espeak-from-msi.py 验证记录）")
