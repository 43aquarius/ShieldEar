#!/usr/bin/env python3
"""cab-mszip.py — 最小 MSZIP CAB 提取器（无需 7z/cabextract）
用法: cab-mszip.py <cab文件> <起始偏移> [关键词...]  → 列出并提取匹配成员到 /tmp/cab-out/
"""
import sys, struct, zlib, os

path = sys.argv[1]
base = int(sys.argv[2], 0)
keys = [k.lower() for k in sys.argv[3:]] if len(sys.argv) > 3 else None

data = open(path, 'rb').read()
assert data[base:base+4] == b'MSCF', '非 CAB 签名'
cbCabinet, csumHeader, cFolders, cFiles, flags, setID = struct.unpack_from('<IIIIHH', data, base + 4)
print(f'CAB @ {base}: 总大小 {cbCabinet:,} · 文件夹数 {cFolders} · 文件数 {cFiles} · flags 0x{flags:04x}')

p = base + 36  # 基础头 36 字节 + 可变区
if flags & 0x0004:  # cbCFHeader / cbCFFolder / cbCFData 保留区
    cbCFHeader = struct.unpack_from('<H', data, base + 36)[0]
    p = base + 36 + cbCFHeader
    print(f'  保留区 cbCFHeader={cbCFHeader}')
elif flags & 0x0001:  # iCabinet + 保留
    p = base + 36 + 4
# 但保留区与 iCabinet 组合下布局不同 —— 逐字节推进直到 CFFOLDER 合理
# （稳健法：CFFOLDER 第一个字段 coffCabStart 必须 > p 且 < 文件大小）
def try_parse_folders(p):
    folders = []
    q = p
    for i in range(cFolders):
        coffCabStart, cCFData, typeCompress = struct.unpack_from('<IHH', data, q)
        if not (base < coffCabStart <= base + cbCabinet) or typeCompress > 0x0104:
            return None
        folders.append((coffCabStart, cCFData, typeCompress))
        q += 8
    return (folders, q)

parsed = None
for probe in range(p, min(p + 64, base + 200)):
    parsed = try_parse_folders(probe)
    if parsed:
        print(f'  CFFOLDER 表 @ {probe - base}(相对)')
        break
assert parsed, 'CFFOLDER 解析失败'
folders, q = parsed

# CFFILE 表
files = []
for i in range(cFiles):
    cbFile, uStartFolder, iFolder, date, time, attribs = struct.unpack_from('<IIIHHH', data, q)
    end = data.index(b'\x00', q + 20)
    name = data[q + 20:end].decode('utf-8', 'replace')
    files.append((name, cbFile, uStartFolder, iFolder))
    q = end + 1
print(f'  共 {len(files)} 个文件:')
for name, cbFile, uStartFolder, iFolder in files:
    print(f'    {cbFile:>10,} B  {name}')

# 提取匹配项（MSZIP 逐块解压）
os.makedirs('/tmp/cab-out', exist_ok=True)
comp_type = folders[0][2]
if (comp_type & 0x000F) != 0x0001:
    print(f'\n✗ 压缩类型 0x{comp_type:04x} 非 MSZIP，无法用 zlib 提取')
    sys.exit(1)

def extract_folder_blocks(folder):
    """按 CFDATA 块顺序产出解压数据"""
    coffCabStart, cCFData, _ = folder
    p2 = coffCabStart
    out = bytearray()
    for _ in range(cCFData):
        csum, cbData, cbUncomp = struct.unpack_from('<IHH', data, p2)
        p2 += 8
        blob = data[p2:p2 + cbData]
        p2 += cbData
        assert blob[:2] == b'CK', 'MSZIP 块签名缺失'
        d = zlib.decompress(blob[2:], -15)
        assert len(d) == cbUncomp, f'块长不符 {len(d)} != {cbUncomp}'
        out.extend(d)
    return bytes(out)

folder_cache = {}
for name, cbFile, uStartFolder, iFolder in files:
    if keys and not any(k in name.lower() for k in keys):
        continue
    if iFolder == 0xFFFD:  # continued
        continue
    if uStartFolder not in folder_cache:
        folder_cache[uStartFolder] = extract_folder_blocks(folders[uStartFolder])
    raw = folder_cache[uStartFolder][:cbFile]
    folder_cache[uStartFolder] = folder_cache[uStartFolder][cbFile:]
    out = os.path.join('/tmp/cab-out', os.path.basename(name))
    open(out, 'wb').write(raw)
    print(f'✓ 提取 {name} → {out} ({len(raw):,} B)')
