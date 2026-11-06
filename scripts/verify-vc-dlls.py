#!/usr/bin/env python3
"""verify-vc-dlls.py — 验证 VC 运行库 DLL 满足 espeak-ng 的全部导入需求
解析 PE 导入表（按 DLL 分组的函数名）与导出表，逐一比对。
"""
import struct, sys

def parse_pe(path):
    d = open(path, 'rb').read()
    e = struct.unpack_from('<I', d, 0x3C)[0]
    assert d[e:e+4] == b'PE\x00\x00'
    nsec = struct.unpack_from('<H', d, e+6)[0]
    opt_size = struct.unpack_from('<H', d, e+20)[0]
    opt = e + 24
    magic = struct.unpack_from('<H', d, opt)[0]
    dd = opt + (112 if magic == 0x20b else 96)
    imp_rva = struct.unpack_from('<I', d, dd+8)[0]
    exp_rva = struct.unpack_from('<I', d, dd)[0]
    sec_off = opt + opt_size
    secs = []
    for i in range(nsec):
        so = sec_off + i*40
        vsz, va, rsz, ro = struct.unpack_from('<IIII', d, so+8)
        secs.append((va, ro, rsz))
    def rva2off(rva):
        for va, ro, rsz in secs:
            if va <= rva < va + max(vsz, rsz):
                return ro + (rva - va)
        return None
    def cstr(off):
        end = d.index(b'\x00', off)
        return d[off:end].decode('ascii', 'replace')
    # 导入表
    imports = {}  # dll名 → [函数名]
    if imp_rva:
        p = rva2off(imp_rva)
        while p:
            oft, ts, fc, name_rva, iat = struct.unpack_from('<IIIII', d, p)
            if name_rva == 0:
                break
            dll = cstr(rva2off(name_rva))
            funcs = []
            thunk = rva2off(oft or iat)
            while thunk:
                val = struct.unpack_from('<Q' if magic == 0x20b else '<I', d, thunk)[0]
                if val == 0:
                    break
                if val & (1 << 63 if magic == 0x20b else 1 << 31):
                    funcs.append(f'#ord{val & 0xffff}')
                else:
                    funcs.append(cstr(rva2off(val + 2)))
                thunk += 8 if magic == 0x20b else 4
            imports[dll.lower()] = funcs
            p += 20
    # 导出表
    exports = set()
    if exp_rva:
        p = rva2off(exp_rva)
        nfuncs, nnames = struct.unpack_from('<II', d, p+20)
        names_rva = struct.unpack_from('<I', d, p+32)[0]
        if names_rva:
            np = rva2off(names_rva)
            for i in range(nnames):
                nrva = struct.unpack_from('<I', d, np + 4*i)[0]
                exports.add(cstr(rva2off(nrva)))
    return imports, exports

# 1. espeak 二进制的导入需求
need = {}
for exe in ['/tmp/espeak-ng.exe', '/tmp/libespeak_ng.dll']:
    imports, _ = parse_pe(exe)
    for dll, funcs in imports.items():
        need.setdefault(dll, set()).update(funcs)

# 2. 我们要发的 DLL 与系统 DLL
provide_files = {
    'msvcp140.dll': '/tmp/vcredist-dlls/msvcp140.dll',
    'vcruntime140.dll': '/tmp/vcredist-dlls/vcruntime140.dll',
    'vcruntime140_1.dll': '/tmp/vcredist-dlls/vcruntime140_1.dll',
}
# libespeak-ng.dll 由包内同目录提供（已确认存在）
system_dlls = {'kernel32.dll', 'advapi32.dll', 'ole32.dll'}          # 系统自带
ucrt = lambda n: n.startswith('api-ms-win-crt-')                     # Win10+ 内置
libespeak = 'libespeak-ng.dll'                                        # 包内同目录

print('=== espeak-ng.exe + libespeak_ng.dll 的导入需求核对 ===\n')
all_ok = True
for dll in sorted(need):
    funcs = need[dll]
    if ucrt(dll):
        print(f'  ✓ {dll}（{len(funcs)} 个函数）→ Windows 10+ 系统 UCRT 内置')
    elif dll in system_dlls:
        print(f'  ✓ {dll}（{len(funcs)} 个函数）→ 系统自带')
    elif dll == libespeak:
        print(f'  ✓ {dll}（{len(funcs)} 个函数）→ 便携包 espeak-ng/ 目录内')
    elif dll in provide_files:
        _, exp = parse_pe(provide_files[dll])
        missing = [f for f in funcs if f not in exp]
        if missing:
            all_ok = False
            print(f'  ✗ {dll}: 缺 {len(missing)}/{len(funcs)} 个导出: {missing[:5]}')
        else:
            print(f'  ✓ {dll}（{len(funcs)} 个函数全部命中）→ 随包 app-local 分发')
    else:
        all_ok = False
        print(f'  ✗ {dll}: 未覆盖！函数: {sorted(funcs)[:5]}')

print()
print('结论:', '全部导入可满足 — Windows 10/11 无 VC++ 运行库也可运行' if all_ok else '存在缺口，需补充')
sys.exit(0 if all_ok else 1)
