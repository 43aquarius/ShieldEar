#!/usr/bin/env python3
"""list-zip-entries.py — 远程 zip 免整包下载：列出中央目录条目（curl 传输版）
用法: list-zip-entries.py <zip-url> [关键词]
沙箱网络已知问题：Python urllib 连接超时，curl 正常 → 全部经 curl 子进程。
"""
import sys, struct, subprocess, tempfile, os

url = sys.argv[1]
key = sys.argv[2].lower() if len(sys.argv) > 2 else None

def curl_range(start, end, out_path):
    """Range 请求 → 写入 out_path，返回字节数"""
    subprocess.run(
        ["curl", "-sL", "--max-time", "120", "--retry", "3",
         "-r", f"{start}-{end}", "-o", out_path, url],
        check=True)
    return os.path.getsize(out_path)

# 1) 总长度
head = subprocess.run(["curl", "-sIL", "--max-time", "60", url],
                      capture_output=True, text=True).stdout
total = None
for line in head.splitlines():
    if line.lower().startswith("content-length:"):
        total = int(line.split(":", 1)[1].strip())
assert total, f"拿不到 Content-Length:\n{head[:500]}"
print(f"远端大小: {total/1048576:.1f} MB")

# 2) 尾部 4MB（EOCD + 中央目录）
tmp = tempfile.mktemp(suffix=".bin")
tail_len = min(total, 4 * 1024 * 1024)
n = curl_range(total - tail_len, total - 1, tmp)
with open(tmp, "rb") as f:
    tail = f.read()
os.unlink(tmp)
eocd = tail.rfind(b"PK\x05\x06")
assert eocd >= 0, "找不到 EOCD"
_, _, _, n_this, n_total, cd_size, cd_off, _ = struct.unpack("<IHHHHIIH", tail[eocd:eocd + 22])
print(f"成员数: {n_total} · 中央目录大小: {cd_size/1024:.0f} KB")

cd_start_in_tail = eocd - cd_size
assert cd_start_in_tail >= 0, "中央目录超出 4MB 窗口"
cd = tail[cd_start_in_tail:eocd]

# 3) 解析条目
entries = []
p = 0
while p + 46 <= len(cd):
    if cd[p:p + 4] != b"PK\x01\x02":
        break
    (sig, vmade, vneed, flag, method, mtime, mdate, crc, csize, usize,
     nlen, elen, clen, disk, iattr, eattr, lho) = struct.unpack("<IHHHHHHIIIHHHHHII", cd[p:p + 46])
    name = cd[p + 46:p + 46 + nlen].decode("utf-8", "replace")
    entries.append((name, csize, usize, lho))
    p += 46 + nlen + elen + clen
print(f"解析条目: {len(entries)}")

hits = [e for e in entries if key is None or key in e[0].lower()]
print(f"匹配 '{key}': {len(hits)} 条")
for name, csize, usize, lho in hits:
    print(f"  {usize:>10,} B  {name}")
