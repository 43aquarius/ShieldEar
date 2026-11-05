#!/usr/bin/env python3
"""zip-range-plan.py — 拉取远程 zip 中央目录，规划成员字节区间
输出 /tmp/cd-index.json：成员名 → (method, csize, usize, local_header_offset, data_start, data_end)
并打印关注成员/子树的总字节区间，供 wget 续传掐点用。
"""
import json, struct, sys, urllib.request

url = sys.argv[1]
TAIL = 2 * 1024 * 1024  # 2MB 窗口（CD 约 300KB，足够）

def fetch(start=None, end=None):
    req = urllib.request.Request(url)
    if start is not None:
        req.add_header("Range", f"bytes={start}-{end}")
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()

req = urllib.request.Request(url, method="HEAD")
with urllib.request.urlopen(req, timeout=60) as r:
    total = int(r.headers["Content-Length"])
print(f"远端总大小: {total} ({total/1048576:.1f} MB)")

tail = fetch(max(0, total - TAIL), total - 1)
eocd = tail.rfind(b"PK\x05\x06")
assert eocd >= 0, "找不到 EOCD"
_, _, _, n_this, n_total, cd_size, cd_off, _ = struct.unpack("<IHHHHIIH", tail[eocd:eocd + 22])
cd_start_in_tail = eocd - cd_size
assert cd_start_in_tail >= 0, "CD 超出窗口"
cd = tail[cd_start_in_tail:eocd]

entries = {}
p = 0
while p + 46 <= len(cd):
    if cd[p:p + 4] != b"PK\x01\x02":
        break
    (sig, vmade, vneed, flag, method, mt, md, crc, csize, usize,
     nlen, elen, clen, disk, iattr, eattr, lho) = struct.unpack("<IHHHHHHIIIHHHHHII", cd[p:p + 46])
    name = cd[p + 46:p + 46 + nlen].decode("utf-8", "replace")
    data_start = lho + 30 + nlen + elen  # 局部头同中央目录的 nlen/elen（绝大多数 zip 如此）
    entries[name] = dict(method=method, csize=csize, usize=usize,
                         lho=lho, data_start=data_start, data_end=lho + 30 + nlen + elen + csize)
    p += 46 + nlen + elen + clen
print(f"解析成员: {len(entries)} / {n_total}")

with open("/tmp/cd-index.json", "w") as f:
    json.dump(entries, f)

# 关注子树的字节区间
def subtree_range(prefix):
    ss, ee = None, None
    for name, e in entries.items():
        if name.startswith(prefix):
            s = e["lho"]
            if ss is None or s < ss: ss = s
            if ee is None or e["data_end"] > ee: ee = e["data_end"]
    return ss, ee

for pre in ["ShieldEar/node.exe", "ShieldEar/espeak-ng/", "ShieldEar/evidence/"]:
    s, e = subtree_range(pre)
    if s is not None:
        print(f"{pre:28s} 字节区间 [{s}, {e}) · {e-s/1:.0f} B ({(e-s)/1048576:.1f} MB)")
    else:
        print(f"{pre:28s} 不存在")
