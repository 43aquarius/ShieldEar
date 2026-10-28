#!/usr/bin/env bash
# 声盾可执行程序包组装脚本 v2 — 三平台免安装（Windows/Linux/macOS）
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
if [ ! -d "$DL/win-extracted" ]; then
  unzip -q /home/z/my-project/runtime-downloads/node-win-x64.zip -d "$DL/win-extracted"
fi
cp "$DL"/win-extracted/node-v22.14.0-win-x64/node.exe "$PKG/runtime/windows/"
cp "$DL"/win-extracted/node-v22.14.0-win-x64/*.dll "$PKG/runtime/windows/" 2>/dev/null || true
tar -xJf /home/z/my-project/runtime-downloads/node-linux-x64.tar.xz -C "$DL"
cp "$DL"/node-v22.14.0-linux-x64/bin/node "$PKG/runtime/linux/node"
chmod +x "$PKG/runtime/linux/node"
tar -xzf /home/z/my-project/runtime-downloads/node-darwin-arm64.tar.gz -C "$DL"
cp "$DL"/node-v22.14.0-darwin-arm64/bin/node "$PKG/runtime/mac/node"
chmod +x "$PKG/runtime/mac/node"
echo "runtime/: $(du -sh "$PKG/runtime" | cut -f1)"

echo "=== [4/8] espeak-ng 离线合成组件（Windows） ==="
cp -r "$DL/espeak-ng-win" "$PKG/espeak-ng"
echo "espeak-ng/: $(du -sh "$PKG/espeak-ng" | cut -f1)"

echo "=== [5/8] ffmpeg 转码工具（Windows，Edge 神经 TTS 通道用） ==="
if [ ! -d "$DL/ffmpeg-win" ]; then
  curl -sL --max-time 240 -o "$DL/ffmpeg-win.tgz" "https://registry.npmjs.org/@ffmpeg-installer/win32-x64/-/win32-x64-4.1.0.tgz"
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

echo "=== [7/8] 平台启动脚本与运行说明 ==="
cat > "$PKG/启动声盾-Windows.bat" <<'BAT'
@echo off
chcp 65001 >nul
title 声盾 ShieldEar · AI 语音鉴伪反诈平台
cd /d "%~dp0"

rem ── espeak-ng 离线合成组件 与 ffmpeg 转码工具 ──
set "PATH=%~dp0espeak-ng;%~dp0tools;%PATH%"
set "ESPEAK_DATA_PATH=%~dp0espeak-ng"

rem ── Node 运行时：优先包内便携版，缺失时回退系统 Node ──
set "NODE_EXE=%~dp0runtime\windows\node.exe"
if not exist "%NODE_EXE%" (
  where node >nul 2>nul && set "NODE_EXE=node"
)
if not exist "%NODE_EXE%" if "%NODE_EXE%"=="node" goto :runnode
if not exist "%NODE_EXE%" (
  echo [启动失败] 未找到 Node.js 运行时，请安装 Node.js 20 或更高版本后重试。
  echo 下载地址: https://nodejs.org/
  pause
  exit /b 1
)
:runnode
echo 声盾正在启动（首次约需数秒），就绪后浏览器将自动打开 http://127.0.0.1:3000
cd /d "%~dp0server"
"%NODE_EXE%" run-shield.js
echo.
echo 服务已停止，感谢使用声盾。
pause
BAT

cat > "$PKG/启动声盾-Linux-Mac.sh" <<'SH'
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
chmod +x "$PKG/启动声盾-Linux-Mac.sh"

cat > "$PKG/运行说明.txt" <<'README'
声盾 ShieldEar —— AI 语音鉴伪反诈平台（可直接运行版）
======================================================================
版本    v1.3.0-calibrated · 2026.10
队伍    你们说的对 · 43aquarius、谭畅 · 大连理工大学
开源    https://github.com/43aquarius/ShieldEar
平台    Windows / Linux / macOS（Apple Silicon）全平台免安装

【一分钟上手】
1. 将本压缩包解压到任意本地目录（路径中尽量避免空格与特殊字符）；
2. Windows 双击「启动声盾-Windows.bat」；Linux/macOS 在终端执行
   bash 启动声盾-Linux-Mac.sh（macOS 亦可直接双击 .sh 选择用终端运行）；
3. 等待数秒，浏览器将自动打开 http://127.0.0.1:3000
   （若 3000 端口被占用，程序会自动改用 3001-3009 并提示实际地址）；
4. 使用完毕后关闭启动窗口（或 Ctrl+C）即可停止服务。

【包内构成】
server/            平台服务（生产构建，含 21 件演示案件与证据 WAV 存档）
runtime/windows/   Windows 便携 Node.js 22 运行时（无需系统安装）
runtime/linux/     Linux x86_64 便携 Node.js 22 运行时
runtime/mac/       Apple Silicon (arm64) 便携 Node.js 22 运行时
espeak-ng/         离线语音合成组件（现场合成挑战的本地合成通道，Windows）
tools/             ffmpeg 转码工具（Edge 神经 TTS 通道用，Windows）

【功能与演示动线】
· 实时鉴听：允许麦克风权限后即可边说边检（无麦克风环境自动容错）；
· 文件检测：拖入 WAV/MP3 即测，或一键试用预置合成/自然对照样本；
· 现场合成挑战：输入任意文本当场合成并当场检出。合成采用四级链路：
  云端 TTS → Edge 神经 TTS → espeak-ng 本地合成 → 预置样本回放，
  自动逐级降级。联网时优先使用神经级音质；完全离线时使用包内
  espeak-ng 真实合成（Windows）/预置回放，界面徽标与存证记录均
  如实标注实际使用的引擎，全程双哈希存证；
· 案例库：历史案件检索、逐窗判决明细、特征剖面、证据 WAV 下载
  （含 SS-20261028-0003 等真实演示案件，可与文档记载交叉核对）；
· 核验报告：每件案件可导出八章节可打印取证报告。

【环境与安全说明】
· 全部检测计算在本机完成，不上传任何音频或检测结果；
· 数据库与证据仅写入 server/db 与 server/evidence 两个本机目录；
· 无需任何 API 密钥或外部账号即可完整体验全部功能；
· 首次启动如被杀毒软件拦截便携运行时，请将本目录加入信任列表。

常见问题
· 端口被占用：自动向后探测 3001-3009，亦可设置 PORT 环境变量指定；
· 浏览器未自动打开：按窗口提示手动访问对应地址；
· Linux/macOS 无法执行 .sh：先执行 chmod +x 启动声盾-Linux-Mac.sh；
· Intel Mac：未内置对应运行时，请安装系统 Node.js 20+ 后运行。
README

echo "=== [8/8] 组装完成 ==="
du -sh "$PKG"
find "$PKG" -maxdepth 1 | sort
