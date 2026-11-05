#!/usr/bin/env python3
"""build-zip-gbk.py — 声盾 v1.3.2 可执行程序包打包器
关键：中文文件名按 GBK 字节写入且不设 UTF-8 标志位（0x800），
使中文 Windows 资源管理器按本地 ANSI/GBK 正确显示（v1.3.0 乱码教训）。
"""
import os, sys, zipfile, stat

SRC = "/home/z/my-project/package-build/ShieldEar"
OUT = "/home/z/my-project/download/ShieldEar-v1.3.2-portable.zip"


class GbkZipInfo(zipfile.ZipInfo):
    """重载文件名编码：GBK 优先、不带 EFS 标志，旧版 Windows 解压兼容"""

    def _encodeFilenameFlags(self):
        try:
            return self.filename.encode("gbk"), 0
        except UnicodeEncodeError:
            return self.filename.encode("utf-8"), 0x800


def iter_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        for name in dirnames + filenames:
            full = os.path.join(dirpath, name)
            if os.path.islink(full):
                continue  # 不打包符号链接
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if rel == ".":
                continue  # 跳过根占位
            yield "ShieldEar/" + rel, full


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    total_raw = 0
    count = 0
    problems = []
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9,
                          allowZip64=True) as zf:
        for rel, full in iter_files(SRC):
            # 自检 1：所有条目名必须能被 GBK 编码（否则中文 Windows 乱码）
            try:
                rel.encode("gbk")
            except UnicodeEncodeError:
                problems.append(rel)
                continue
            if os.path.isdir(full):
                zi = GbkZipInfo(rel + "/")
                zi.external_attr = (0o40755 << 16) | 0x10
                zf.writestr(zi, b"")
                continue
            zi = GbkZipInfo(rel, date_time=(2026, 10, 30, 12, 0, 0))
            mode = stat.S_IMODE(os.stat(full).st_mode)
            zi.external_attr = (mode & 0xFFFF) << 16
            zi.compress_type = zipfile.ZIP_DEFLATED
            with open(full, "rb") as f:
                data = f.read()
            zf.writestr(zi, data)
            total_raw += len(data)
            count += 1
            if count % 300 == 0:
                print(f"  … {count} 条目", flush=True)

    size = os.path.getsize(OUT)
    print(f"完成：{count} 文件 · 原始 {total_raw/1048576:.1f}MB → 压缩 {size/1048576:.1f}MB")

    if problems:
        print("✗ 存在无法 GBK 编码的条目：")
        for p in problems:
            print("  ", p)
        sys.exit(1)

    # 自检 2：回读中央目录 —— 无 EFS 标志条目按「CP437 字节 → GBK」回环验证
    with zipfile.ZipFile(OUT) as zf:
        bad = 0
        for zi in zf.infolist():
            if zi.flag_bits & 0x800:
                continue  # UTF-8 标志条目（ASCII 名）无需处理
            try:
                zi.filename.encode("cp437").decode("gbk")
            except (UnicodeEncodeError, UnicodeDecodeError):
                bad += 1
        names = zf.namelist()
        # 中文名期望值经同样回环后比对
        def gbk_name(s):
            return s.encode("gbk").decode("cp437")
        for must in [gbk_name("启动声盾-Windows.bat"), gbk_name("运行说明.txt"),
                     gbk_name("启动声盾-Linux-Mac.sh"), "START-ShieldEar.bat",
                     "server/run-shield.js", "server/db/custom.db",
                     "espeak-ng/espeak-ng.exe", "tools/ffmpeg.exe", "node-win/node.exe",
                     "runtime/linux-x64/node", "runtime/darwin-arm64/node",
                     "server/.next/server/chunks/"]:
            hit = any(must.rstrip("/") in n for n in names)
            print(("  ✓ " if hit else "  ✗ 缺失 ") + must.encode("cp437").decode("gbk"))
            if not hit:
                bad += 1
        zh = [n for n in names if any(ord(c) > 127 for c in n)]
        print(f"中文名条目 {len(zh)} 个，回环校验异常 {bad} 个")
        sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
