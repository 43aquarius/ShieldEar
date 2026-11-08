#!/usr/bin/env python3
"""pe-imports-functions.py — 函数级 PE 导入表解析（bug 2 根因实证）

问题：espeak-ng.exe 处理命令行是否 UTF-16 感知（GetCommandLineW /
CommandLineToArgvW / wmain）？
  · 若有 → argv 以 UTF-8 正确到达，v1.3.9 乱读另有根因
  · 若无 → argv 由 CRT 按 ANSI 代码页（中文 Windows = GBK）转换，
    程序按 UTF-8 解读 → 乱码 → 「完全不是正常能听的语音」实锤
"""
import struct
import sys


def rva_to_off(rva, sections):
    for name, vs, va, raw, rawsz in sections:
        if va <= rva < va + max(vs, rawsz):
            return raw + (rva - va)
    return None


def parse_functions(path):
    data = open(path, "rb").read()
    pe = struct.unpack("<I", data[0x3C:0x40])[0]
    assert data[pe:pe + 4] == b"PE\x00\x00"
    coff = pe + 4
    machine, nsec = struct.unpack("<HH", data[coff:coff + 4])
    opt_size = struct.unpack("<H", data[coff + 16:coff + 18])[0]
    opt = coff + 20
    magic = struct.unpack("<H", data[opt:opt + 2])[0]
    pe32plus = magic == 0x20B
    # 数据目录：PE32+ 偏移 112，PE32 偏移 96；导入表是第 2 项
    dd_off = opt + (112 if pe32plus else 96)
    imp_rva, imp_sz = struct.unpack("<II", data[dd_off + 8:dd_off + 16])
    # 节表
    sec_off = opt + opt_size
    sections = []
    for i in range(nsec):
        s = sec_off + i * 40
        name = data[s:s + 8].rstrip(b"\x00").decode()
        vs, va, rawsz, raw = struct.unpack("<IIII", data[s + 8:s + 24])
        sections.append((name, vs, va, raw, rawsz))
    imp_off = rva_to_off(imp_rva, sections)
    funcs = {}
    p = imp_off
    while True:
        oft, ts, fc, name_rva, iat = struct.unpack("<IIIII", data[p:p + 20])
        if name_rva == 0:
            break
        dll = data[rva_to_off(name_rva, sections):].split(b"\x00")[0].decode()
        thunk = rva_to_off(oft or iat, sections)
        names = []
        while True:
            v = struct.unpack("<Q" if pe32plus else "<I", data[thunk:thunk + (8 if pe32plus else 4)])[0]
            if v == 0:
                break
            if v & (1 << 63 if pe32plus else 1 << 31):
                names.append(f"#ordinal{v & 0xFFFF}")
            else:
                no = rva_to_off(v, sections)
                names.append(data[no + 2:no + 2 + 64].split(b"\x00")[0].decode())
            thunk += 8 if pe32plus else 4
        funcs[dll] = names
        p += 20
    return funcs


funcs = parse_functions("/tmp/msi-out/espeak-ng.exe")
print("espeak-ng.exe 函数级导入表：")
for dll, names in funcs.items():
    print(f"  {dll}: {', '.join(names)}")

# 判定
flat = {n for names in funcs.values() for n in names}
waware = [n for n in flat if n in (
    "GetCommandLineW", "CommandLineToArgvW", "wmain", "WideCharToMultiByte",
)]
ansi = [n for n in flat if n in ("GetCommandLineA", "mbstowcs", "setlocale")]
print()
print(f"UTF-16 感知 API: {waware or '无'}")
print(f"ANSI 路径 API: {ansi or '无'}")
if "GetCommandLineW" in flat or "CommandLineToArgvW" in flat:
    print("→ 结论：程序自行以 UTF-16 取命令行（可能正确转 UTF-8）")
else:
    print("→ 结论：argv 由 CRT 按 ANSI 代码页转换 —— 中文 Windows(GBK) 下")
    print("  UTF-8 中文文本经 argv 传入必乱码，bug 2（乱读）根因实锤；")
    print("  stdin 字节流方案（v1.3.10）绕开此层，为正确修法。")
