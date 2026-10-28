#!/usr/bin/env bash
# 声盾可执行程序包组装脚本 v3 — 三平台免安装（Windows/Linux/macOS）
# v1.3.1 修复：
#   · Windows 启动批处理改为 GBK(cp936) 编码 —— 中文 Windows cmd 原生解析，
#     消除 v1.3.0 UTF-8 批处理被按 GBK 误读导致的乱码与执行异常
#   · 新增纯 ASCII 兜底入口 START-ShieldEar.bat（任何区域设置的 Windows 均可执行）
#   · Linux/macOS 启动脚本改用 ASCII 文件名（配合 GBK 文件名 zip，Linux 解压不乱码）
#   · 运行说明.txt 改为 UTF-8 with BOM（记事本自动识别，杜绝乱码）
#   · espeak-ng 组件换用 msys2 官方构建（exe+dll+完整数据树，中文声库已验证）
# 依赖：已完成 `bun run build`（.next/standalone 就绪）、三平台 Node 运行时已下载
set -e
cd /home/z/my-project

PKG=/home/z/my-project/package-build/ShieldEar
DL=/home/z/my-project/package-build/downloads
rm -rf "$PKG"
mkdir -p "$PKG/server" "$PKG/runtime/windows" "$PKG/runtime/linux" "$PKG/runtime/mac" "$PKG/tools"

echo "=== [1/8] standalone 服务（清理无关目录 + 裁剪） ==="
SA=/home/z/my-project/.next/standalone
cp "$SA/server.js" "$PKG/server/"
cp "$SA/package.json" "$PKG/server/"
cp -r "$SA/.next" "$PKG/server/.next"
cp -r "$SA/public" "$PKG/server/public"
# node_modules：拷贝后裁剪开发期与未用平台二进制
cp -r "$SA/node_modules" "$PKG/server/node_modules"
rm -rf "$PKG/server/node_modules/@img" "$PKG/server/node_modules/typescript" "$PKG/server/node_modules/.bin"
# 覆盖 Prisma 生成客户端：确保三平台查询引擎齐备（windows/linux/darwin-arm64）
rm -rf "$PKG/server/node_modules/.prisma"
cp -r /home/z/my-project/node_modules/.prisma "$PKG/server/node_modules/.prisma"
echo "server/ assembled: $(du -sh "$PKG/server" | cut -f1)"

echo "=== [2/8] 数据库（21 件演示案件）与证据存档 ==="
mkdir -p "$PKG/server/db"
cp /home/z/my-project/db/custom.db "$PKG/server/db/custom.db"
cp -r /home/z/my-project/evidence "$PKG/server/evidence"
cp /home/z/my-project/repo-stage/LICENSE "$PKG/LICENSE" 2>/dev/null || true

echo "=== [3/8] 三平台 Node 便携运行时 ==="
if [ ! -d "$DL/node-v22.14.0-win-x64" ]; then
  unzip -q /home/z/my-project/runtime-downloads/node-win-x64.zip -d "$DL"
fi
cp "$DL"/node-v22.14.0-win-x64/node.exe "$PKG/runtime/windows/"
cp "$DL"/node-v22.14.0-win-x64/*.dll "$PKG/runtime/windows/" 2>/dev/null || true
if [ ! -x "$DL/node-v22.14.0-linux-x64/bin/node" ]; then
  tar -xJf /home/z/my-project/runtime-downloads/node-v22.14.0-linux-x64.tar.xz -C "$DL"
fi
cp "$DL"/node-v22.14.0-linux-x64/bin/node "$PKG/runtime/linux/node"
chmod +x "$PKG/runtime/linux/node"
if [ ! -x "$DL/node-v22.14.0-darwin-arm64/bin/node" ]; then
  tar -xzf /home/z/my-project/runtime-downloads/node-v22.14.0-darwin-arm64.tar.gz -C "$DL"
fi
cp "$DL"/node-v22.14.0-darwin-arm64/bin/node "$PKG/runtime/mac/node"
chmod +x "$PKG/runtime/mac/node"
echo "runtime/: $(du -sh "$PKG/runtime" | cut -f1)"

echo "=== [4/8] espeak-ng 离线合成组件（Windows · msys2 官方构建） ==="
cp -r "$DL/espeak-ng-win-msys2" "$PKG/espeak-ng"
echo "espeak-ng/: $(du -sh "$PKG/espeak-ng" | cut -f1)"

echo "=== [5/8] ffmpeg 转码工具（Windows，Edge 神经 TTS 通道用） ==="
if [ ! -f "$DL/ffmpeg-win/package/ffmpeg.exe" ]; then
  mkdir -p "$DL/ffmpeg-win" && tar xzf "$DL/ffmpeg-win.tgz" -C "$DL/ffmpeg-win"
fi
cp "$DL/ffmpeg-win/package/ffmpeg.exe" "$PKG/tools/ffmpeg.exe"
echo "tools/: $(du -sh "$PKG/tools" | cut -f1)"

echo "=== [6/8] 启动引导 run-shield.js ==="
cat > "$PKG/server/run-shield.js" <<'RUNSHIELD'
/**
 * 声盾 ShieldEar 启动引导 —— 在加载 Next standalone 服务前完成运行时环境装配
 * · 数据库强制定位到包内 server/db/custom.db（与启动目录、外部环境变量解耦；
 *   如需指向其他数据库，设置 SHIELD_DB_URL 环境变量）
 * · 端口自动探测（默认 3000，被占用时向后寻找空闲端口）
 * · 服务就绪后自动打开浏览器
 * · 规避 Windows 下系统 HOSTNAME 环境变量（机器名）导致的绑定异常
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");

process.env.NODE_ENV = "production";
process.env.HOSTNAME = process.env.SHIELD_HOST || "127.0.0.1";

function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch (_) { /* 浏览器打开失败不影响服务 */ }
}

(async () => {
  let port = parseInt(process.env.PORT, 10) || 3000;
  if (!process.env.PORT) {
    for (let p = port; p < port + 10; p++) {
      if (await checkPort(p)) { port = p; break; }
    }
  }
  process.env.PORT = String(port);
  const url = "http://127.0.0.1:" + port;

  const dbPath = path.join(__dirname, "db", "custom.db").replace(/\\/g, "/");
  process.env.DATABASE_URL = process.env.SHIELD_DB_URL || "file:" + dbPath;

  console.log("");
  console.log("  声盾 ShieldEar · AI 语音鉴伪反诈平台");
  console.log("  ------------------------------------");
  console.log("  正在启动本地服务（首次约需数秒）…");

  const t0 = Date.now();
  let opened = false;
  const poll = setInterval(() => {
    http.get(url + "/", (res) => {
      res.resume();
      if (res.statusCode < 500 && !opened) {
        opened = true;
        clearInterval(poll);
        console.log("  服务已就绪（" + ((Date.now() - t0) / 1000).toFixed(1) + " 秒），浏览器即将打开 " + url);
        console.log("  若浏览器未自动打开，请手动访问上述地址。");
        console.log("  使用完毕后关闭本窗口（或按 Ctrl+C）即可停止服务。");
        setTimeout(() => openBrowser(url), 400);
      }
    }).on("error", () => { /* 服务尚未监听，继续等待 */ });
  }, 400);
  setTimeout(() => clearInterval(poll), 90 * 1000);

  require("./server.js");
})().catch((err) => {
  console.error("启动失败：", err && err.message);
  process.exit(1);
});
RUNSHIELD

echo "=== [7/8] 平台启动脚本与运行说明（编码修复） ==="
# 7.1 Windows 批处理 —— 先写 UTF-8 源，再转 GBK（中文 Windows cmd 原生编码）
cat > "$PKG/.bat-utf8.tmp" <<'BAT'
@echo off
title 声盾 ShieldEar · AI 语音鉴伪反诈平台
cd /d "%~dp0"

rem espeak-ng 离线合成组件与 ffmpeg 转码工具（服务已内置绝对路径定位，此处 PATH 仅为双保险）
set "PATH=%~dp0espeak-ng;%~dp0tools;%PATH%"
set "ESPEAK_DATA_PATH=%~dp0espeak-ng"

rem Node 运行时：优先包内便携版，缺失时回退系统 Node
set "NODE_EXE=%~dp0runtime\windows\node.exe"
if exist "%NODE_EXE%" goto :runnode
where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE_EXE=node"
  goto :runnode
)
echo [启动失败] 未找到 Node.js 运行时，请安装 Node.js 20 或更高版本后重试。
echo 下载地址: https://nodejs.org/
pause
exit /b 1

:runnode
echo 声盾正在启动（首次约需数秒），就绪后浏览器将自动打开 http://127.0.0.1:3000
cd /d "%~dp0server"
"%NODE_EXE%" run-shield.js
echo.
echo 服务已停止，感谢使用声盾。
pause
BAT
python3 -c "
import sys
src = open(sys.argv[1], encoding='utf-8').read()
# DOS 批处理标准 CRLF 行尾 + GBK 编码（中文 Windows cmd 原生解析）
open(sys.argv[2], 'wb').write(src.replace('\r\n', '\n').replace('\n', '\r\n').encode('gbk'))
" "$PKG/.bat-utf8.tmp" "$PKG/启动声盾-Windows.bat" && rm -f "$PKG/.bat-utf8.tmp"

# 7.2 纯 ASCII 兜底入口（任何区域设置的 Windows 均可正常执行）
cat > "$PKG/.bat2-ascii.tmp" <<'BAT2'
@echo off
title ShieldEar - AI Voice Anti-Fraud Platform
cd /d "%~dp0"
set "PATH=%~dp0espeak-ng;%~dp0tools;%PATH%"
set "ESPEAK_DATA_PATH=%~dp0espeak-ng"
set "NODE_EXE=%~dp0runtime\windows\node.exe"
if exist "%NODE_EXE%" goto :runnode
where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE_EXE=node"
  goto :runnode
)
echo [ERROR] Node.js runtime not found. Please install Node.js 20+ from https://nodejs.org/
pause
exit /b 1
:runnode
echo ShieldEar is starting (takes a few seconds on first run)...
echo Browser will open http://127.0.0.1:3000 automatically when ready.
cd /d "%~dp0server"
"%NODE_EXE%" run-shield.js
echo.
echo Service stopped. Thank you for using ShieldEar.
pause
BAT2
python3 -c "
import sys
src = open(sys.argv[1], encoding='utf-8').read()
open(sys.argv[2], 'wb').write(src.replace('\r\n', '\n').replace('\n', '\r\n').encode('ascii'))
" "$PKG/.bat2-ascii.tmp" "$PKG/START-ShieldEar.bat" && rm -f "$PKG/.bat2-ascii.tmp"

# 7.3 Linux/macOS 启动脚本（ASCII 文件名，内容 UTF-8）
cat > "$PKG/start-shield-linux-mac.sh" <<'SH'
#!/usr/bin/env bash
# 声盾 ShieldEar · Linux / macOS 启动脚本（包内含便携 Node 运行时）
cd "$(dirname "$0")"
SYS="$(uname -s 2>/dev/null || echo Linux)"
ARCH="$(uname -m 2>/dev/null || echo x86_64)"
NODE_EXE=""
if [ "$SYS" = "Darwin" ] && [ "$ARCH" = "arm64" ] && [ -x "runtime/mac/node" ]; then
  NODE_EXE="$PWD/runtime/mac/node"
elif [ "$SYS" != "Darwin" ] && [ -x "runtime/linux/node" ]; then
  NODE_EXE="$PWD/runtime/linux/node"
fi
if [ -z "$NODE_EXE" ]; then
  NODE_EXE="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE_EXE" ]; then
  echo "[启动失败] 未找到 Node.js 运行时。"
  echo "本包内置 Linux x86_64 与 Apple Silicon（arm64）便携运行时；"
  echo "其他架构请安装 Node.js 20 或更高版本后重试：https://nodejs.org/"
  exit 1
fi
cd server
echo "声盾正在启动（首次约需数秒），就绪后浏览器将自动打开。"
exec "$NODE_EXE" run-shield.js
SH
chmod +x "$PKG/start-shield-linux-mac.sh"

# 7.4 运行说明 —— UTF-8 with BOM（记事本自动识别，杜绝乱码）
python3 /home/z/my-project/scripts/packaging/write-readme.py

echo "=== [8/8] 组装完成 ==="
du -sh "$PKG"
find "$PKG" -maxdepth 1 | sort
echo ""
echo "下一步: python3 scripts/packaging/build-zip.py  （生成 GBK 文件名 zip）"
