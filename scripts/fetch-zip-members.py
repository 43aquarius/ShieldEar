#!/usr/bin/env python3
"""fetch-zip-members.py — 远程 zip 免整包下载：Range 请求只取指定成员
用法: fetch-zip-members.py <zip-url> <关键词1> [关键词2 ...]
原理: 拉 zip 尾部 EOCD+中央目录 → 定位成员 → Range 取局部头+压缩数据 → 解压
"""
import sys, struct, zlib, urllib.request

url = sys.argv[1]
keys = sys.argv[2:]

def fetch(start=None, end=None):
    req = urllib.request.Request(url)
    if start is not None:
        req.add_header("Range", f"bytes={start}-{end}")
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()

# 1) 拿总长度（跟随重定向后的对象存储直链）
req = urllib.request.Request(url, method="HEAD")
with urllib.request.urlopen(req, timeout=60) as r:
    total = int(r.headers["Content-Length"])
print(f"远端大小: {total/1048576:.1f} MB")

# 2) 拉尾部 2MB（EOCD + 中央目录）
tail = fetch(max(0, total - 2 * 1024 * 1024), total - 1)
eocd = tail.rfind(b"PK\x05\x06")
assert eocd >= 0, "找不到 EOCD"
_, _, _, n_this, n_total, cd_size, cd_off, _ = struct.unpack("<IHHHHIIH", tail[eocd:eocd + 22])
print(f"成员数: {n_total} · 中央目录大小: {cd_size} B")

# 3) 中央目录在尾部窗口内的起点（相对整个文件）
cd_start_in_tail = eocd - cd_size
assert cd_start_in_tail >= 0, "中央目录超出 2MB 窗口，需加大"
cd = tail[cd_start_in_tail:eocd]

# 4) 解析中央目录条目
entries = {}
p = 0
while p + 46 <= len(cd):
    if cd[p:p + 4] != b"PK\x01\x02":
        break
    (sig, vmade, vneed, flag, method, mtime, mdate, crc, csize, usize,
     nlen, elen, clen, disk, iattr, eattr, lho) = struct.unpack("<IHHHHHHIIIHHHHHII", cd[p:p + 46])
    name = cd[p + 46:p + 46 + nlen].decode("utf-8", "replace")
    entries[name] = (method, csize, usize, lho)
    p += 46 + nlen + elen + clen
print(f"解析条目: {len(entries)}")

# 5) 匹配关键词 → Range 取数据
for name, (method, csize, usize, lho) in entries.items():
    if not any(k.lower() in name.lower() for k in keys):
        continue
    print(f"\n===== {name} (csize={csize}, usize={usize}) =====")
    if csize == 0 and usize == 0:
        continue
    # 局部头最长 30+65535+65535，保守取 csize+130k；再按头部修正
    blob = fetch(lho, lho + 30 + 65535 * 2 + csize)
    assert blob[:4] == b"PK\x03\x04", "局部头损坏"
    nlen2, elen2 = struct.unpack("<HH", blob[26:30])
    data = blob[30 + nlen2 + elen2:30 + nlen2 + elen2 + csize]
    if method == 8:
        raw = zlib.decompress(data, -15)
    else:
        raw = data
    out = "/tmp/zip-members/" + name.replace("/", "__").replace("[", "(").replace("]", ")")
    import os
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as f:
        f.write(raw)
    print(f"已存: {out} ({len(raw)} B)")
