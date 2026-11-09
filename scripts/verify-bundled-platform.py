#!/usr/bin/env python3
"""
verify-bundled-platform.py — 打包硬闸（v1.3.9 引入；v1.3.11 收敛）

背景（v1.3.9 根因）：Next.js 16 Turbopack 在服务端打包时会把
`process.platform === "win32"` 按【构建机】平台常量折叠（本流水线构建机
为 Linux → 折叠为 false），随后 DCE 整段裁掉 win32 分支。折叠发生在
构建期且【比较表达式会被整体抹除】，事后无法通过搜索 process.platform
残留来发现。

v1.3.11 变更：随合成挑战功能移除，espeak-ng / ffmpeg 探测代码与
「字面量存活」两道闸（原硬闸 1/2）一并退役；保留并泛化最有价值的一道：

  硬闸（泛化防线）：chunk 中不允许出现 `process.platform===`
  比较残留 —— 出现即说明有新代码引入了会被构建机平台折叠的分支，
  无论该分支服务于什么功能。

用法：python3 verify-bundled-platform.py <standalone目录或包内server目录>
退出码：0 通过 / 1 拒绝（详见输出）
"""
import re
import sys
from pathlib import Path


def scan(root: Path) -> int:
    chunk_dirs = [root / ".next" / "server" / "chunks", root / "server" / ".next" / "server" / "chunks"]
    chunks: list[Path] = []
    for d in chunk_dirs:
        if d.is_dir():
            chunks = sorted(p for p in d.glob("*.js") if p.is_file())
            break
    if not chunks:
        print("✗ 未找到服务端 chunks 目录（.next/server/chunks）——路径不对或构建不完整")
        return 1

    failures: list[str] = []
    for p in chunks:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            failures.append(f"无法读取 {p.name}: {e}")
            continue
        if re.search(r"process\.platform\s*===", text):
            failures.append(
                f"[{p.name}] 发现 process.platform 比较残留（打包期会被构建机平台折叠，请改用按名探测）"
            )

    if failures:
        print("✗ 平台折叠硬闸未通过：")
        for f in failures:
            print("  - " + f)
        print("\n修复指引：")
        print("  服务端代码禁止 `process.platform === \"win32\"` 常量分支（构建机非 Windows 时会被折叠）；")
        print("  平台差异改用 existsSync 按名探测（同时尝试带/不带 .exe 的候选名）。")
        return 1

    print(f"✓ 平台折叠硬闸通过（{len(chunks)} 个服务端 chunk，无平台常量比较残留）")
    return 0


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    root = Path(sys.argv[1])
    if not root.is_dir():
        print(f"✗ 目录不存在: {root}")
        return 2
    return scan(root)


if __name__ == "__main__":
    sys.exit(main())
