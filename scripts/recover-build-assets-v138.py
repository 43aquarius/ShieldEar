#!/usr/bin/env python3
"""recover-build-assets-v138.py — 从 v1.3.7 Release zip 恢复构建资产（公开直链版，无需 token）
流程：github.com 公开下载页 302 → CDN 直链 → 下载尾部 2MB（EOCD+中央目录）
      → 解析 espeak-ng/* + node.exe 成员区间 → 16 段并行下载 → 逐成员 CRC32 校验落盘
产物：/tmp/node.exe + /tmp/msi-out/（espeak-ng.exe / libespeak_ng.dll / espeak-ng-data/…）
"""
import os, struct, subprocess, sys, threading, time, zlib

URL_PAGE = "https://github.com/43aquaris/ShieldEar/releases/download/v1.3.7/ShieldEar-v1.3.7-portable.zip"
OUT_SPAN = "/tmp/span.bin"

# ── 1. 解析签名直链（aka 302 → CDN；重试应对主站路由抖动）──
direct = os.environ.get("ASSET_DIRECT_URL", "")
if not direct:
    for _ in range(12):
        direct = subprocess.run(["curl", "-s", "--max-time", "60", "-o", "/dev/null",
                                 "-w", "%{redirect_url}", URL_PAGE],
                                capture_output=True, text=True).stdout.strip()
        if direct.startswith("https://"):
            break
        time.sleep(3)
assert direct.startswith("https://"), f"直链解析失败: {direct[:200]}"
print(f"CDN 直链就绪（{direct[:80]}…）")

# ── 2. 拿 zip 总大小（HEAD）──
size = 0
for _ in range(8):
    r = subprocess.run(["curl", "-sI", "--max-time", "60", direct],
                       capture_output=True, text=True).stdout
    for line in r.splitlines():
        if line.lower().startswith("content-length:"):
            size = int(line.split(":", 1)[1].strip())
    if size > 10_000_000:
        break
    time.sleep(2)
assert size > 10_000_000, f"zip 大小异常: {size}"
print(f"zip 总大小 {size:,} B（{size/1048576:.1f} MB）")

# ── 3. 下载尾部 2MB（含中央目录）──
TAIL = 2_000_000
tstart = size - TAIL
tail_path = "/tmp/tail-test.bin"
for i in range(8):
    rc = subprocess.run(["curl", "-s", "--max-time", "300",
                         "-r", f"{tstart}-", "-o", tail_path, direct]).returncode
    if rc == 0 and os.path.exists(tail_path) and os.path.getsize(tail_path) > 1_000_000:
        break
    time.sleep(3)
else:
    sys.exit("✗ 尾部下载失败")

tail = open(tail_path, "rb").read()
eocd = tail.rfind(b"PK\x05\x06")
assert eocd >= 0, "EOCD 不在尾部"
_, _, _, n_this, n_total, cd_size, cd_off, _ = struct.unpack("<IHHHHIIH", tail[eocd:eocd + 22])
cd = tail[eocd - cd_size:eocd]
assert len(cd) == cd_size, "中央目录不完整"

entries = {}
p = 0
while p + 46 <= len(cd):
    if cd[p:p + 4] != b"PK\x01\x02":
        break
    (sig, vmade, vneed, flag, method, mt, md, crc, csize, usize,
     nlen, elen, clen, disk, iattr, eattr, lho) = struct.unpack("<IHHHHHHIIIHHHHHII", cd[p:p + 46])
    name = cd[p + 46:p + 46 + nlen].decode("utf-8", "replace")
    entries[name] = dict(method=method, crc=crc, csize=csize, usize=usize, lho=lho)
    p += 46 + nlen + elen + clen
print(f"中央目录成员: {len(entries)}")

# ── 4. 计算目标区间（espeak-ng 全套 + node.exe）──
targets = {n: e for n, e in entries.items()
           if n.startswith("ShieldEar/espeak-ng/") or n == "ShieldEar/node.exe"}
lo = min(e["lho"] for e in targets.values())
hi = max(e["lho"] + 30 + len(n.encode()) + e["csize"] for n, e in targets.items())
span = hi - lo
print(f"目标 {len(targets)} 成员 · 区间 [{lo:,}, {hi:,}) · {span/1048576:.1f} MB")

# ── 5. 并行分段下载 ──
NCHUNK = 16
seg = (span + NCHUNK - 1) // NCHUNK
t0 = time.time()

def dl_chunk(i):
    s, e = lo + i * seg, min(lo + (i + 1) * seg - 1, hi - 1)
    if s > e:
        return i, 0
    want = e - s + 1
    part = f"/tmp/span.part{i:02d}"
    for attempt in range(8):
        rc = subprocess.run(["curl", "-s", "--max-time", "1800",
                             "-r", f"{s}-{e}", "-o", part, direct]).returncode
        sz = os.path.getsize(part) if os.path.exists(part) else 0
        if rc == 0 and sz == want:
            return i, sz
        print(f"  段 {i} 第 {attempt+1} 次失败 rc={rc} sz={sz}/{want}，重试…")
        time.sleep(2)
    return i, -1

results = {}
def worker(i):
    results[i] = dl_chunk(i)
threads = [threading.Thread(target=worker, args=(i,)) for i in range(NCHUNK)]
for th in threads:
    th.start()
for th in threads:
    th.join()
bad = [i for i, sz in results.values() if sz < 0]
if bad:
    sys.exit(f"✗ 段失败: {bad}")
print(f"分段下载完成 · 用时 {time.time()-t0:.0f}s")

parts = [f"/tmp/span.part{i:02d}" for i in range(NCHUNK)]
got = 0
for i, part in enumerate(parts):
    sz = os.path.getsize(part) if os.path.exists(part) else 0
    want = min(seg, span - i * seg)
    if sz != want:
        sys.exit(f"✗ 段 {i} 大小不符: {sz} != {want}")
    got += sz
print(f"合计 {got:,} B（期望 {span:,}）")
with open(OUT_SPAN, "wb") as f:
    for part in parts:
        f.write(open(part, "rb").read())
print(f"✓ 合并 → {OUT_SPAN}")
for part in parts:
    os.unlink(part)

# ── 6. 提取成员（逐个 CRC32 校验）──
blob = open(OUT_SPAN, "rb").read()
os.makedirs("/tmp/msi-out", exist_ok=True)
ok = fail = 0
for name, e in sorted(targets.items()):
    rel_lho = e["lho"] - lo
    hdr = blob[rel_lho:rel_lho + 30]
    assert hdr[:4] == b"PK\x03\x04", f"{name}: 局部头损坏"
    nlen2, elen2 = struct.unpack("<HH", hdr[26:30])
    assert elen2 == 0, f"{name}: 局部头有扩展字段（提取器假设失效）"
    dstart = rel_lho + 30 + nlen2
    data = blob[dstart:dstart + e["csize"]]
    raw = zlib.decompress(data, -15) if e["method"] == 8 else data
    assert len(raw) == e["usize"], f"{name}: 解压大小不符 {len(raw)} != {e['usize']}"
    if (zlib.crc32(raw) & 0xFFFFFFFF) != e["crc"]:
        print(f"✗ {name}: CRC 不符")
        fail += 1
        continue
    if name == "ShieldEar/node.exe":
        out = "/tmp/node.exe"
    else:
        rel = name[len("ShieldEar/espeak-ng/"):]
        out = os.path.join("/tmp/msi-out", rel)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "wb").write(raw)
    ok += 1

print(f"\n提取完成: {ok} 成功 / {fail} 失败")
if fail:
    sys.exit(1)
print(f"/tmp/node.exe: {os.path.getsize('/tmp/node.exe'):,} B")
r = subprocess.run(["file", "/tmp/node.exe", "/tmp/msi-out/espeak-ng.exe", "/tmp/msi-out/libespeak_ng.dll"],
                   capture_output=True, text=True)
print(r.stdout)
n_data = sum(len(files) for _, _, files in os.walk("/tmp/msi-out/espeak-ng-data"))
print(f"/tmp/msi-out/espeak-ng-data: {n_data} 个数据文件")
print("✓ 构建资产恢复完成（v1.3.7 来源，espeak/node 组件与 v1.3.8 所需零漂移）")
