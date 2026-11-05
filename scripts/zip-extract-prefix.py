#!/usr/bin/env python3
"""zip-extract-prefix.py — 从截断的 zip 前缀中按中央目录索引提取成员
用法: zip-extract-prefix.py <bin> <cd-index.json> <前缀过滤> <输出根目录>
成员名形如 ShieldEar/espeak-ng/... ，输出时去掉首段 ShieldEar/。
"""
import json, struct, sys, zlib, os

binpath, idxpath, prefix, outroot = sys.argv[1:5]
data = open(binpath, "rb").read()
idx = json.load(open(idxpath))
os.makedirs(outroot, exist_ok=True)

n_ok = n_skip = 0
for name, e in sorted(idx.items()):
    if not name.startswith(prefix):
        continue
    lho = e["lho"]
    if lho + 30 > len(data):
        n_skip += 1
        continue
    assert data[lho:lho + 4] == b"PK\x03\x04", f"局部头损坏: {name}"
    nlen, elen = struct.unpack("<HH", data[lho + 26:lho + 30])
    name_start = lho + 30
    lname = data[name_start:name_start + nlen].decode("utf-8", "replace")
    assert lname == name, f"名称不匹配: {lname} != {name}"
    dstart = name_start + nlen + elen
    dend = dstart + e["csize"]
    if dend > len(data):
        n_skip += 1
        continue
    blob = data[dstart:dend]
    raw = zlib.decompress(blob, -15) if e["method"] == 8 else blob
    assert len(raw) == e["usize"], f"解压大小不符: {name}"
    rel = name.split("/", 1)[1] if "/" in name else name
    dest = os.path.join(outroot, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(raw)
    n_ok += 1

print(f"提取 {n_ok} 个成员 → {outroot}（跳过 {n_skip} 个超范围）")
