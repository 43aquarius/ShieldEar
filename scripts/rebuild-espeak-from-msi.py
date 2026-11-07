#!/usr/bin/env python3
"""rebuild-espeak-from-msi.py — 从官方 espeak-ng 1.52.0 MSI 零漂移重建 /tmp/msi-out
格式（实证破译，见会话记录）：该 MSI 内嵌 CAB 为 WiX 变体——
  头部 MSCF 后文件表 @44 起，每项 16 字节头 {cbFile:4, start:4, 保留:8} + 名字\\0
  （start 为解压流中的累积偏移，非标准 CAB 的 uFolder 语义）
  单一 MSZIP 文件夹：CFFOLDER@36 = (coffCabStart=10,053, cCFData=748, type=MSZIP)
自验：exe 导入表含连字符 libespeak-ng.dll（v1.3.8 根因物证）+ 数据文件与
      系统 espeak-ng 1.52.0 逐字节比对 + 尺寸与 worklog 记录核对。
"""
import olefile, struct, sys, zlib, os, shutil, hashlib

MSI = "/tmp/espeak-ng.msi"
OUT = "/tmp/msi-out"
LOCAL_DATA = "/usr/lib/x86_64-linux-gnu/espeak-ng-data"
DATA_OFF = None  # 从 CFFOLDER 动态读

ole = olefile.OleFileIO(MSI)
best = max(ole.listdir(), key=lambda s: ole.get_size(s))
cab = ole.openstream(best).read()
ole.close()
assert cab[:4] == b"MSCF"

# ── 1. CFFOLDER@36：读数据区起点与块数 ──
coffCabStart, cCFData, typeCompress = struct.unpack_from("<IHH", cab, 36)
assert typeCompress & 0x000F == 0x0001, f"非 MSZIP: {typeCompress:#x}"
DATA_OFF, NBLK = coffCabStart, cCFData
print(f"[1] 数据区 @{DATA_OFF:,} · {NBLK} 个 MSZIP 块")

# ── 2. 文件表 @44：16 字节头 {cbFile, start, 保留 8} + 名字 ──
entries, p = [], 44
while p + 16 <= DATA_OFF:
    cbFile, start = struct.unpack_from("<II", cab, p)
    if cbFile == 0 and start == 0:
        break
    q = cab.index(b"\x00", p + 16)
    name = cab[p + 16:q].decode("utf-8", "replace")
    entries.append((name, cbFile, start))
    p = q + 1
print(f"[2] 文件表 {len(entries)} 项（表区 44→{p}，恰填满至数据区，差异 {DATA_OFF - p} B）")
assert p == DATA_OFF, "文件表未恰好填满表区（格式假设失效）"
# 注：该 WiX 变体 CAB 头部的 cFiles 字段不可靠（实测 44 vs 实际 443），
#     以「表区恰填满 + start 累积校验 + 解压总量对齐」三重自洽为准。
# start 必须为累积递增
running = 0
for name, cbFile, start in entries:
    assert start == running, f"{name}: start {start} != 累积 {running}"
    running += cbFile
total_unc = running
print(f"[3] 解压流总量 {total_unc:,} B（{total_unc/1048576:.1f} MB）· start 累积校验全过")

# ── 3. 解压全部 MSZIP 块（块间共享 32KB 滑窗 → zdict 预置字典续窗）──
blob = bytearray()
p2 = DATA_OFF
hist = b""
for i in range(NBLK):
    csum, cbData, cbUncomp = struct.unpack_from("<IHH", cab, p2)
    p2 += 8
    blk = cab[p2:p2 + cbData]
    p2 += cbData
    assert blk[:2] == b"CK", f"块 {i} 签名缺失"
    # MSZIP：每块为 raw deflate 段，但其 32KB 窗口延续自前块输出——
    # 用 preset dictionary（zdict）注入上一块尾部 32KB 以恢复窗口
    d = zlib.decompressobj(-15, zdict=hist)
    out = d.decompress(blk[2:], cbUncomp)
    assert len(out) == cbUncomp, f"块 {i}: {len(out)} != {cbUncomp}"
    blob.extend(out)
    hist = bytes(blob[-32768:])
assert len(blob) == total_unc, f"解压总量 {len(blob):,} != {total_unc:,}"
print(f"[4] ✓ {NBLK} 块解压完成，CAB 数据区消费至 {p2:,}（流长 {len(cab):,}）")
assert p2 == len(cab), "数据区尾部与流长不齐"

# ── 4. 切片重建 msi-out ──
if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)
norm = lambda n: n.replace("-", "_").replace("!", "").lower()
local_map = {}
for root, dirs, fs in os.walk(LOCAL_DATA):
    for fn in fs:
        local_map.setdefault(norm(fn), os.path.relpath(os.path.join(root, fn), LOCAL_DATA))

matched, unmatched, exe_found, dll_found = 0, [], False, False
for name, cbFile, start in entries:
    base = os.path.basename(name.replace("\\", "/"))
    raw = bytes(blob[start:start + cbFile])
    if base.lower() in ("espeak_ng.exe", "espeak-ng.exe"):
        open(os.path.join(OUT, "espeak-ng.exe"), "wb").write(raw)
        exe_found = True
    elif base.lower() in ("libespeak_ng.dll", "libespeak-ng.dll"):
        open(os.path.join(OUT, "libespeak_ng.dll"), "wb").write(raw)
        dll_found = True
    else:
        rel = local_map.get(norm(base))
        if rel:
            dst = os.path.join(OUT, "espeak-ng-data", rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            open(dst, "wb").write(raw)
            matched += 1
        else:
            unmatched.append(base)

print(f"[5] 映射：matched={matched} unmatched={len(unmatched)} exe={exe_found} dll={dll_found}")
if unmatched:
    print("    丢弃（与 v1.3.2 原始流程一致）:", unmatched[:12])

# ── 5. 自验 ──
exe = open(os.path.join(OUT, "espeak-ng.exe"), "rb").read()
dll = open(os.path.join(OUT, "libespeak_ng.dll"), "rb").read()
print(f"[6] espeak-ng.exe {len(exe):,} B · libespeak_ng.dll {len(dll):,} B")
assert 10_000 < len(exe) < 100_000, "exe 尺寸异常（worklog ≈27KB）"
assert 300_000 < len(dll) < 800_000, "dll 尺寸异常（worklog ≈477KB）"

import importlib.util
_spec = importlib.util.spec_from_file_location(
    "vpi", "/home/z/my-project/scripts/verify-package-imports.py")
_vpi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_vpi)
parse_pe_imports = _vpi.parse_pe_imports
imports = parse_pe_imports(os.path.join(OUT, "espeak-ng.exe"))
assert "libespeak-ng.dll" in imports, f"导入表无连字符名: {imports}"
print("[7] ✓ espeak-ng.exe 导入表确认要求 libespeak-ng.dll（连字符）—— v1.3.7 事故根因物证")
print("    exe 全部导入:", sorted(imports))
dll_imports = parse_pe_imports(os.path.join(OUT, "libespeak_ng.dll"))
print("    dll 全部导入:", sorted(dll_imports))

same = diff = 0
for root, dirs, fs in os.walk(os.path.join(OUT, "espeak-ng-data")):
    for fn in fs:
        mine = open(os.path.join(root, fn), "rb").read()
        lp = os.path.join(LOCAL_DATA, fn)
        if os.path.exists(lp):
            if hashlib.sha256(mine).digest() == hashlib.sha256(open(lp, "rb").read()).digest():
                same += 1
            else:
                diff += 1
print(f"[8] 数据文件 vs 系统 espeak-ng 1.52.0：逐字节相同 {same} · 不同 {diff}")

n_data = sum(len(fs) for _, _, fs in os.walk(os.path.join(OUT, "espeak-ng-data")))
print(f"[9] ✓ /tmp/msi-out 重建完成（espeak-ng-data {n_data} 文件）")
print("    SHA-256 espeak-ng.exe:     ", hashlib.sha256(exe).hexdigest())
print("    SHA-256 libespeak_ng.dll:  ", hashlib.sha256(dll).hexdigest())
