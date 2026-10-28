#!/usr/bin/env bash
# 声盾可执行程序包组装脚本
set -e
cd /home/z/my-project

PKG=/home/z/my-project/package-build/ShieldEar
STAGE=/home/z/my-project/package-build/staging
rm -rf "$PKG" "$STAGE"
mkdir -p "$PKG/server" "$STAGE"

echo "=== [1/6] 复制 standalone 服务（含裁剪） ==="
SA=/home/z/my-project/.next/standalone
cp "$SA/server.js" "$PKG/server/"
cp "$SA/package.json" "$PKG/server/" 2>/dev/null || true
cp -r "$SA/.next" "$PKG/server/.next"
cp -r "$SA/public" "$PKG/server/public"
cp -r "$SA/node_modules" "$PKG/server/node_modules"
# 裁剪：sharp 平台二进制（33MB，应用未用 next/image）与 typescript（20MB，仅开发期需要）
rm -rf "$PKG/server/node_modules/@img" "$PKG/server/node_modules/typescript" "$PKG/server/node_modules/.bin"
du -sh "$PKG/server/node_modules"

echo "=== [2/6] 数据库与证据存档 ==="
mkdir -p "$PKG/server/db"
cp db/custom.db "$PKG/server/db/custom.db"
cp -r evidence "$PKG/server/evidence"

echo "=== [3/6] Windows 便携 Node 运行时 ==="
cd "$STAGE"
unzip -q /home/z/my-project/package-build/downloads/node-win.zip -d .
NODEDIR=$(find . -maxdepth 1 -type d -name "node-v*" | head -1)
mkdir -p "$PKG/node-win"
cp "$NODEDIR"/node.exe "$NODEDIR"/*.dll "$PKG/node-win/" 2>/dev/null || cp "$NODEDIR"/node.exe "$PKG/node-win/"
# npm/corepack 属包管理器，运行服务不需要
du -sh "$PKG/node-win"

echo "=== [4/6] espeak-ng 离线合成组件 ==="
cp -r /home/z/my-project/package-build/downloads/espeak-ng-win "$PKG/espeak-ng"
du -sh "$PKG/espeak-ng"

echo "=== [5/6] 启动引导 / 脚本 / 说明 ==="
cd /home/z/my-project

cat > "$PKG/server/run-shield.js" <<'EOF'
/**
 * 声盾 ShieldEar 启动引导 —— 加载 Next standalone 服务前设置运行时环境
 * 数据库自动定位到包内 server/db/custom.db，与启动时的当前目录解耦
 */
const path = require("path");
process.env.NODE_ENV = "production";
process.env.PORT = process.env.PORT || "3000";
process.env.HOSTNAME = process.env.HOSTNAME || "127.0.0.1";
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:" + path.join(__dirname, "db", "custom.db");
}
require("./server.js");
EOF

cat > "$PKG/启动声盾-Windows.bat" <<'EOF'
@echo off
chcp 65001 >nul
title 声盾 ShieldEar · AI 语音鉴伪平台
cd /d "%~dp0"

rem ── 选择 Node 运行时：优先系统 Node，缺失时使用包内便携版 ──
set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%~dp0node-win\node.exe" set "NODE_EXE=%~dp0node-win\node.exe"
if not defined NODE_EXE (
  echo [启动失败] 未找到 Node.js 运行时，请安装 Node.js 20 或更高版本后重试。
  echo 下载地址: https://nodejs.org/
  pause
  exit /b 1
)

rem ── espeak-ng 离线合成组件（存在则启用） ──
if exist "%~dp0espeak-ng\espeak-ng.exe" (
  set "PATH=%~dp0espeak-ng;%PATH%"
  set "ESPEAK_DATA_PATH=%~dp0espeak-ng"
)

cd /d "%~dp0server"
echo 声盾正在启动（首次约需数秒），浏览器将自动打开 http://127.0.0.1:3000
echo 演示期间请保持本窗口开启，使用完毕直接关闭本窗口即可停止服务。
start "" /min cmd /c "timeout /t 5 /nobreak >nul & start http://127.0.0.1:3000"
"%NODE_EXE%" run-shield.js
echo.
echo 服务已停止。
pause
EOF

cat > "$PKG/启动声盾-Linux-Mac.sh" <<'EOF'
#!/usr/bin/env bash
# 声盾 ShieldEar · Linux / macOS 启动脚本
cd "$(dirname "$0")"
NODE_EXE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_EXE" ]; then
  echo "[启动失败] 未找到 Node.js，请安装 Node.js 20 或更高版本后重试（https://nodejs.org/）"
  exit 1
fi
cd server
echo "声盾正在启动（首次约需数秒），浏览器将自动打开 http://127.0.0.1:3000"
echo "演示期间请保持本终端运行，使用完毕按 Ctrl+C 停止服务。"
( sleep 5; xdg-open http://127.0.0.1:3000 >/dev/null 2>&1 || open http://127.0.0.1:3000 >/dev/null 2>&1 ) &
exec "$NODE_EXE" run-shield.js
EOF
chmod +x "$PKG/启动声盾-Linux-Mac.sh"

cat > "$PKG/运行说明.txt" <<'EOF'
声盾 ShieldEar —— AI 语音鉴伪反诈平台（可直接运行版）
======================================================================
版本    v1.3.0-calibrated · 2026.10
队伍    你们说的对 · 谭畅 等 2 人 · 大连理工大学
开源    github.com/43aquarius/ShieldEar

【一分钟上手】
1. 将本压缩包解压到任意本地目录（路径中尽量避免空格与特殊字符）；
2. Windows 双击「启动声盾-Windows.bat」；Linux/macOS 在终端执行
   bash 启动声盾-Linux-Mac.sh；
3. 等待数秒，浏览器将自动打开 http://127.0.0.1:3000；
4. 使用完毕后关闭启动窗口（或 Ctrl+C）即可停止服务。

【包内构成】
server/     平台服务（生产构建，含演示案例库与证据存档）
node-win/   Windows 便携 Node.js 运行时（无需系统安装 Node）
espeak-ng/  离线语音合成组件（现场合成挑战的本地合成通道）

【功能与演示动线】
· 实时鉴听：允许麦克风权限后即可边说边检（无麦克风环境自动容错）；
· 文件检测：拖入 WAV/MP3 即测，或一键试用预置合成/自然对照样本；
· 现场合成挑战：输入任意文本当场合成并当场检出——本包内建
  espeak-ng 本地合成通道，用户输入的文本被真实合成；界面徽标与
  存证记录会如实标注实际使用的引擎，全程双哈希存证；
· 案例库：历史案件检索、逐窗判决明细、特征剖面、证据 WAV 下载；
· 核验报告：每件案件可导出八章节可打印取证报告。

【环境与安全说明】
· 全部检测计算在本机完成，不上传任何音频或检测结果；
· 数据库与证据仅写入 server/db 与 server/evidence 两个本机目录；
· 默认端口 3000，如被占用可在启动前设置环境变量 PORT 换端口；
· 无需任何 API 密钥或外部账号即可完整体验全部功能。

常见问题
· 端口被占用：设置 PORT 环境变量后重启；
· 浏览器未自动打开：手动访问 http://127.0.0.1:3000；
· 杀毒软件拦截便携运行时：将本目录加入信任列表后重试。
EOF

echo "=== [6/6] 组装完成 ==="
du -sh "$PKG"
find "$PKG" -maxdepth 1 | sort
