#!/usr/bin/env python3
"""build-zip.py — 声盾 v1.3.1 发行包 zip 构建（中文文件名 GBK 编码）

修复 v1.3.0 的 zip 文件名乱码：
  v1.3.0 的 zip 以 UTF-8 编码存储中文文件名。Windows 资源管理器对
  无 EFS 标志（或被忽略）的条目按系统 ANSI 代码页解码——中文系统
  即 GBK，UTF-8 字节被按 GBK 误读，出现「鍚姩澹扮浘-Windows.bat」
  式乱码，且批处理内容同样乱码导致执行异常。

本构建器对含中文的条目名按 GBK 编码写入且不设置 UTF-8 标志：
  中文 Windows 解压 → 按 GBK 解码 → 文件名正确显示；
  ASCII 文件名条目不受影响；Linux/macOS 用 unzip 解压时仅两个
  中文命名条目显示为乱码名（启动入口均已是 ASCII 文件名，不受影响）。

用法: python3 build-zip.py [输出版本号，默认 v1.3.1]
"""
import os
import sys
import time
import zipfile


class GbkZipInfo(zipfile.ZipInfo):
    """非 ASCII 文件名按 GBK 字节写入且不设 UTF-8 (0x800) 标志。

    Python zipfile 原生行为：非 ASCII 名一律 UTF-8 编码 + 0x800 标志。
    中文 Windows 资源管理器对带标志的条目多数版本能正确处理，但历史上
    存在忽略标志按 ANSI 误读的案例（v1.3.0 乱码根源）。为确保中文系统
    100% 正确，这里改为 GBK 字节 + 无标志：条目名先按 GBK 编码、再逐
    字节映射到 cp437 字符集（zip 规范的传统编码），写入时逆映射回原字节。"""

    def _encodeFilenameFlags(self):
        try:
            return self.filename.encode("ascii"), self.flag_bits
        except UnicodeEncodeError:
            return self.filename.encode("cp437"), self.flag_bits & ~0x800

PKG_ROOT = "/home/z/my-project/package-build/ShieldEar"
ZIP_TOP = "ShieldEar"  # zip 内顶层目录
OUT = "/home/z/my-project/download/ShieldEar-v1.3.1-portable.zip"
VERSION = sys.argv[1] if len(sys.argv) > 1 else "v1.3.1"
OUT = OUT.replace("v1.3.1", VERSION)

def gbk_entry_name(name: str) -> str:
    """中文文件名 → GBK 字节 → 按 cp437 逐字节解码为 str。
    zipfile 写入该 str 时会重新编码为 cp437（得到原 GBK 字节），
    且因非 ASCII 编码走 cp437 分支而不设置 UTF-8 (0x800) 标志。"""
    try:
        name.encode("ascii")
        return name  # 纯 ASCII：无需处理
    except UnicodeEncodeError:
        return name.encode("gbk").decode("cp437")

def main() -> None:
    if not os.path.isdir(PKG_ROOT):
        print("包目录不存在，请先运行 assemble-package.sh")
        sys.exit(1)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if os.path.exists(OUT):
        os.remove(OUT)

    t0 = time.time()
    count = 0
    total_bytes = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(PKG_ROOT):
            dirs.sort()
            for fn in sorted(files):
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, PKG_ROOT).replace(os.sep, "/")
                arc = f"{ZIP_TOP}/{rel}"
                st = os.stat(full)
                zi = GbkZipInfo(gbk_entry_name(arc), date_time=time.localtime(st.st_mtime)[:6])
                zi.compress_type = zipfile.ZIP_DEFLATED
                # 保留执行位（.sh / node 二进制等）
                zi.external_attr = (st.st_mode & 0xFFFF) << 16
                with open(full, "rb") as f:
                    zf.writestr(zi, f.read())
                count += 1
                total_bytes += st.st_size
                if count % 1000 == 0:
                    print(f"  已写入 {count} 文件…", flush=True)

    size = os.path.getsize(OUT)
    print(f"✓ zip 完成: {OUT}")
    print(f"  条目数 {count} · 原始 {total_bytes/1048576:.1f}MB → 压缩 {size/1048576:.1f}MB · 耗时 {time.time()-t0:.0f}s")

    # 自检 1：GBK 名条目在中文 Windows 视角下的解码结果
    with zipfile.ZipFile(OUT) as zf:
        problems = []
        for zi in zf.infolist():
            raw = zi.filename
            if zi.flag_bits & 0x800:
                problems.append(f"意外 UTF-8 标志: {raw}")
                continue
            # 模拟中文 Windows 资源管理器：按 GBK 解码
            try:
                decoded = raw.encode("cp437").decode("gbk")
                if any("\u4e00" <= c <= "\u9fff" for c in decoded):
                    pass  # 正常中文
            except Exception as e:
                problems.append(f"GBK 解码失败 {raw}: {e}")
        if problems:
            print("⚠ 自检问题:")
            for p in problems[:10]:
                print("  -", p)
        else:
            print("✓ 自检通过：全部条目可被中文 Windows 按 GBK 正确解码")

if __name__ == "__main__":
    main()
