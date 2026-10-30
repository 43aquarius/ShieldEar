#!/usr/bin/env python3
"""write-launchers.py — 生成 v1.3.2 包的启动脚本与运行说明（多编码）"""
import os

P = "/home/z/my-project/package-build/ShieldEar"

# ── 1. 启动声盾-Windows.bat（GBK + CRLF，中文 cmd 原生解析） ──
bat_gbk = "\r\n".join([
    "@echo off",
    "cd /d \"%~dp0\"",
    "title 声盾 ShieldEar",
    "echo.",
    "echo   声盾 ShieldEar - AI 语音鉴伪反诈平台",
    "echo   正在启动本地服务（首次约需数秒，请勿关闭本窗口）...",
    "echo.",
    "node-win\\node.exe server\\run-shield.js",
    "echo.",
    "echo   服务已停止。",
    "pause",
]) + "\r\n"
with open(os.path.join(P, "启动声盾-Windows.bat"), "wb") as f:
    f.write(bat_gbk.encode("gbk"))

# ── 2. START-ShieldEar.bat（纯 ASCII 兜底） ──
bat_ascii = "\r\n".join([
    "@echo off",
    "cd /d \"%~dp0\"",
    "title ShieldEar",
    "echo.",
    "echo   ShieldEar - AI Voice Anti-Fraud Platform",
    "echo   Starting local service (first run may take a few seconds)...",
    "echo.",
    "node-win\\node.exe server\\run-shield.js",
    "echo.",
    "echo   Service stopped.",
    "pause",
]) + "\r\n"
with open(os.path.join(P, "START-ShieldEar.bat"), "wb") as f:
    f.write(bat_ascii.encode("ascii"))

# ── 3. Linux/macOS 启动脚本（ASCII 文件名 + UTF-8 中文名，同一内容） ──
sh = "\n".join([
    "#!/usr/bin/env bash",
    "# ShieldEar launcher for Linux / macOS",
    "cd \"$(dirname \"$0\")\"",
    "OS=\"$(uname -s)\"; ARCH=\"$(uname -m)\"",
    "NODE=\"\"",
    "case \"$OS/$ARCH\" in",
    "  Linux/x86_64)  NODE=\"runtime/linux-x64/node\" ;;",
    "  Linux/aarch64) NODE=\"runtime/linux-x64/node\" ;;",
    "  Darwin/arm64)  NODE=\"runtime/darwin-arm64/node\" ;;",
    "  Darwin/*)      NODE=\"runtime/darwin-x64/node\" ;;",
    "esac",
    "if [ -n \"$NODE\" ] && [ -f \"$NODE\" ]; then",
    "  chmod +x \"$NODE\" 2>/dev/null",
    "  exec \"$NODE\" server/run-shield.js",
    "elif command -v node >/dev/null 2>&1; then",
    "  echo \"[提示] 未找到包内对应架构的 Node，改用系统 node\"",
    "  exec node server/run-shield.js",
    "else",
    "  echo \"[错误] 未找到可用的 Node.js 运行时\" >&2",
    "  exit 1",
    "fi",
]) + "\n"
for name in ["start-shield-linux-mac.sh", "启动声盾-Linux-Mac.sh"]:
    fp = os.path.join(P, name)
    with open(fp, "wb") as f:
        f.write(sh.encode("utf-8"))
    os.chmod(fp, 0o755)

# ── 4. 运行说明.txt（UTF-8 BOM，记事本正确识别） ──
txt = """声盾 ShieldEar · AI 语音鉴伪反诈平台 — 运行说明（v1.3.2）
════════════════════════════════════════════════════════════

一、快速启动
  Windows：双击「启动声盾-Windows.bat」
           （若中文文件名在您的系统显示乱码，请改用 START-ShieldEar.bat）
  Linux / macOS：终端执行  bash start-shield-linux-mac.sh

  启动后自动打开浏览器，默认地址 http://127.0.0.1:3000
  （端口被占用时自动顺延至 3001-3009，以启动窗口显示的地址为准）
  首次启动约需数秒；关闭启动窗口（或按 Ctrl+C）即停止服务

二、本版本默认「完全离线」
  「合成挑战」使用本地 espeak-ng 合成引擎现场合成您输入的文本，
  全程零联网、零外部依赖，断网环境完全可用；
  「实时鉴听」「文件检测」「案例存证」「报告导出」任何模式下均为纯本地功能。

  如需切换为云端神经音色（更自然，需联网）：
    1. 在本包根目录（与启动脚本同一层）新建一个空文本文件
    2. 命名为 ENABLE-ONLINE-TTS.txt（注意保留 .txt 扩展名）
    3. 重新启动后即生效；删除该文件并重启则回到离线模式
  实际使用的合成引擎会在检测结果与存证记录中如实标注。

三、常见问题
  · 端口占用：自动向后寻找空闲端口，以启动窗口打印的地址为准
  · Windows 安全提示：本包自带 Node.js 运行时（node-win/）与 espeak-ng
    合成器（espeak-ng/），均为开源组件；如杀毒软件拦截请选择「允许」
  · 数据保存：检测案例存于包内 server/db/custom.db，
    删除该文件并重启即恢复初始状态
  · 遇电信诈骗请拨 96110

四、组件与许可
  Node.js v22.14.0（MIT License）
  espeak-ng 1.52（GPLv3，见 espeak-ng/licenses/）
  ffmpeg（LGPL/GPL，仅联网模式的 Edge 通道转码使用）
  完整声明见 LICENSE 文件

项目主页：https://github.com/43aquarius/ShieldEar
声盾 ShieldEar v1.3.2 · 信息安全竞赛作品 · 队伍：你们说的对
"""
with open(os.path.join(P, "运行说明.txt"), "wb") as f:
    f.write(b"\xef\xbb\xbf" + txt.encode("utf-8"))

print("启动脚本与说明已生成：")
for n in os.listdir(P):
    if os.path.isfile(os.path.join(P, n)):
        print(" ", n, os.path.getsize(os.path.join(P, n)), "bytes")
