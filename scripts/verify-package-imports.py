#!/usr/bin/env python3
"""verify-package-imports.py — v1.3.8 打包硬闸：PE 导入表完整性校验
背景（v1.3.7 事故复盘）：espeak-ng.exe 导入表要求 libespeak-ng.dll（连字符），
包内文件却是 libespeak_ng.dll（下划线）—— 一字之差导致所有 Windows 机器上
0xC0000135。当时的 verify-vc-dlls.py 只核对了 VC++ 三 DLL 的导入/导出函数匹配，
对 libespeak-ng.dll 仅注释「包内同目录提供（已确认存在）」直接放行，未按名核实。
（v1.3.11：espeak-ng 组件已随合成挑战功能移除出包；本闸继续守护包内
 其余 PE——node.exe / Prisma query_engine-windows.dll.node / VC++ 三 DLL。）

规则：扫描目录树下全部 PE 文件（.exe/.dll/.node，MZ 魔数确认），
其导入表（含延迟导入表）引用的每一个 DLL 必须满足：
  a) 在同目录按「精确文件名」存在（Windows 加载器 app-local 解析），或
  b) 属于系统白名单（Windows 自带，大小写不敏感；api-ms-win-*/ext-ms-* 前缀放行）
任何一条不满足 → 退出码 1，构建终止（绝不带病打包）。

用法：python3 verify-package-imports.py <目录> [--deep]
  --deep 同时扫描 .node 文件（默认开启；--deep=0 关闭）
"""
import os, struct, sys

SYSTEM_DLLS = {
    # Windows 自带（Win10/11 x64 常见集合）
    "kernel32.dll", "user32.dll", "gdi32.dll", "advapi32.dll", "shell32.dll",
    "ole32.dll", "oleaut32.dll", "ws2_32.dll", "msvcrt.dll", "ntdll.dll",
    "bcrypt.dll", "crypt32.dll", "secur32.dll", "shlwapi.dll", "version.dll",
    "comctl32.dll", "comdlg32.dll", "winmm.dll", "imm32.dll", "uxtheme.dll",
    "dbghelp.dll", "psapi.dll", "iphlpapi.dll", "userenv.dll", "powrprof.dll",
    "setupapi.dll", "cfgmgr32.dll", "wintrust.dll", "mswsock.dll", "wsock32.dll",
    "dnsapi.dll", "rasapi32.dll", "netapi32.dll", "user32.dll", "dwmapi.dll",
    "winhttp.dll", "wininet.dll", "normaliz.dll", "wldap32.dll", "rpcrt4.dll",
    "sspicli.dll", "profapi.dll", "cryptbase.dll", "bcryptprimitives.dll",
    "ncrypt.dll", "cryptsp.dll", "ncryptbcrypt.dll", "msvcp140_app.dll",
}
SYSTEM_PREFIXES = ("api-ms-win-", "ext-ms-win-", "api-ms-crt-")


def parse_pe_imports(path):
    """返回该 PE 的全部被导入 DLL 名（导入表 + 延迟导入表，小写）"""
    d = open(path, "rb").read()
    if d[:2] != b"MZ":
        return None
    e = struct.unpack_from("<I", d, 0x3C)[0]
    if d[e:e + 4] != b"PE\x00\x00":
        return None
    nsec = struct.unpack_from("<H", d, e + 6)[0]
    opt_size = struct.unpack_from("<H", d, e + 20)[0]
    opt = e + 24
    magic = struct.unpack_from("<H", d, opt)[0]
    dd = opt + (112 if magic == 0x20b else 96)
    imp_rva = struct.unpack_from("<I", d, dd + 8)[0]          # 目录项 1：导入表
    dly_rva = struct.unpack_from("<I", d, dd + 13 * 8)[0]     # 目录项 13：延迟导入表
    sec_off = opt + opt_size
    secs = []
    for i in range(nsec):
        so = sec_off + i * 40
        vsz, va, rsz, ro = struct.unpack_from("<IIII", d, so + 8)
        secs.append((va, vsz, ro, rsz))

    def rva2off(rva):
        for va, vsz, ro, rsz in secs:
            if va <= rva < va + max(vsz, rsz):
                return ro + (rva - va)
        return None

    def cstr(off):
        end = d.index(b"\x00", off)
        return d[off:end].decode("ascii", "replace")

    names = set()
    # 常规导入表：每描述符 20B，name_rva 在偏移 12
    for rva in (imp_rva, dly_rva):
        if not rva:
            continue
        p = rva2off(rva)
        while p:
            if rva == imp_rva:
                oft, ts, fc, name_rva, iat = struct.unpack_from("<IIIII", d, p)
                if name_rva == 0:
                    break
            else:
                # 延迟导入描述符：grAttrs, szName RVA, phmod, pIAT, pINT …（32B）
                grattrs, name_rva, phmod, piat, pint = struct.unpack_from("<IIIII", d, p)
                if name_rva == 0:
                    break
            noff = rva2off(name_rva)
            if noff is None:
                break
            names.add(cstr(noff).lower())
            p += 20 if rva == imp_rva else 32
    return names


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "/tmp/package-build/ShieldEar"
    scan_node = "--deep=0" not in sys.argv
    pe_files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for f in sorted(filenames):
            ext = os.path.splitext(f)[1].lower()
            if ext in (".exe", ".dll") or (scan_node and ext == ".node"):
                pe_files.append(os.path.join(dirpath, f))
    print(f"扫描 PE 文件: {len(pe_files)} 个（根: {root}）")

    failures = []
    # 包根目录文件集（node.exe 等宿主/运行时位于包根，不在各子目录）
    root_files = {x.lower() for x in os.listdir(root)} if os.path.isdir(root) else set()
    for p in pe_files:
        try:
            imports = parse_pe_imports(p)
        except Exception as ex:
            failures.append(f"{p}: 解析异常 {ex}")
            continue
        if not imports:
            continue
        same_dir = {x.lower() for x in os.listdir(os.path.dirname(p))}
        is_node_addon = p.lower().endswith(".node")
        rel = os.path.relpath(p, root)
        for dll in sorted(imports):
            if dll in same_dir or dll in root_files:
                continue
            # .node 插件对宿主进程（node.exe）的导入由宿主运行时解析（delay-load
            # 常规机制），不依赖同目录文件 —— 放行
            if is_node_addon and dll == "node.exe":
                continue
            if dll in SYSTEM_DLLS or any(dll.startswith(pfx) for pfx in SYSTEM_PREFIXES):
                continue
            failures.append(
                f"{rel}: 导入 {dll} —— 同目录与包根均无此文件且非系统 DLL"
                f"（app-local 解析将失败 → 0xC0000135）"
            )

    if failures:
        print("\n✗ 导入表完整性校验失败（%d 项）：" % len(failures))
        for f in failures:
            print("  ✗ " + f)
        sys.exit(1)
    print(f"✓ 全部 PE 导入可解析（{len(pe_files)} 个文件 · 系统白名单 + app-local 双通道核对）")


if __name__ == "__main__":
    main()
