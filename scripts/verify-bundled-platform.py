#!/usr/bin/env python3
"""
verify-bundled-platform.py — 打包硬闸（v1.3.9）

背景（v1.3.9 根因）：Next.js 16 Turbopack 在服务端打包时会把
`process.platform === "win32"` 按【构建机】平台常量折叠（本流水线构建机
为 Linux → 折叠为 false），随后 DCE 整段裁掉 win32 分支。源码里正确的
`IS_WIN ? "espeak-ng.exe" : "espeak-ng"` 候选在产物中退化为裸名
"espeak-ng"：existsSync 不自动补 .exe → 包内候选永远落空 → 合成挑战
恒走预置回放（v1.3.1 起所有 Linux 构建的 Windows 包均中招，直到 v1.3.9
改为平台无关探测才根除）。

折叠发生在构建期且【比较表达式会被整体抹除】，事后无法通过搜索
process.platform 残留来发现 —— 因此本闸校验「平台相关字面量必须在
产物中存活」：

  硬闸 1（全局存在性）：全部服务端 chunk 中至少出现一次
          "espeak-ng.exe" 与 "ffmpeg.exe" 字面量（被折叠即全局消失）；
  硬闸 2（同 chunk 配对）：含探测代码标记（libespeak-ng.dll /
          ESPEAK_DATA_PATH）的 chunk 必须同时含 "espeak-ng.exe"
          —— 防止字面量被挪到无关 chunk 造成的假通过；
  硬闸 3（泛化防线）：chunk 中不允许出现 `process.platform===`
          比较残留（出现即说明有新代码引入会被折叠的平台分支）。

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
    texts: dict[str, str] = {}
    for p in chunks:
        try:
            texts[p.name] = p.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            failures.append(f"无法读取 {p.name}: {e}")

    # 硬闸 1：全局存在性（被折叠即全局消失）
    for lit in ("espeak-ng.exe", "ffmpeg.exe"):
        if not any(lit in t for t in texts.values()):
            failures.append(
                f"全部服务端 chunk 中均未出现字面量 \"{lit}\" —— 疑似 Turbopack 平台常量折叠"
                f"（构建机非 Windows 时 win32 分支被 DCE），拒绝打包"
            )

    # 硬闸 2：探测代码所在 chunk 必须带 .exe 候选与数据路径注入
    for name, text in texts.items():
        if "libespeak-ng.dll" in text or "ESPEAK_DATA_PATH" in text:
            missing = [lit for lit in ("espeak-ng.exe", "ESPEAK_DATA_PATH") if lit not in text]
            if missing:
                failures.append(
                    f"[{name}] 含 espeak 探测代码标记，但缺少 {missing} —— 拒绝打包"
                )

    # 硬闸 3：不允许出现会被折叠的平台比较残留
    for name, text in texts.items():
        if re.search(r"process\.platform\s*===", text):
            failures.append(
                f"[{name}] 发现 process.platform 比较残留（打包期会被构建机平台折叠，请改用按名探测）"
            )

    if failures:
        print("✗ 平台折叠硬闸未通过：")
        for f in failures:
            print("  - " + f)
        print("\n修复指引：")
        print("  1. 服务端代码禁止 `process.platform === \"win32\"` 常量分支（构建机为 Linux 时会被折叠）；")
        print("  2. 平台差异改用 existsSync 按名探测（espeak-ng.exe / espeak-ng 都试）；")
        print("  3. 详见 src/lib/server/local-tts.ts 顶部 v1.3.9 注释。")
        return 1

    n_probe = sum(1 for t in texts.values() if "espeak-ng.exe" in t)
    print(f"✓ 平台折叠硬闸通过（{len(chunks)} 个服务端 chunk；{n_probe} 个含 espeak 探测且 .exe 候选存活；ffmpeg.exe 候选存活）")
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
