#!/usr/bin/env bash
# ============================================================
# build-portable.sh — v1.3.5 纯离线便携包组装（完整流水线）
# 前置：npm run build:offline 已完成；/tmp/{node.exe, msi-out} 就位
# 产物：/tmp/package-build/ShieldEar/（Windows 交付目录）
#
# v1.3.5 变更：
#   · 纯离线发行锁（SHIELD_RELEASE_OFFLINE）随 boot.js 注入；
#   · boot.js 启动自检：Prisma 引擎/数据库/校准数据缺失时
#     打印明确提示并退出，杜绝"带病启动 → 页面 500"；
#   · 组装前后双重 fail-fast 校验（引擎文件必须进包）；
#   · 数据库必须含种子案例（空库直接报错，防"案例库空白"）。
#
# 注意：最终包只含 Windows Prisma 引擎；Linux 断网测试由
#       test-offline-portable.sh 临时补 debian 引擎后自行清理
# ============================================================
set -euo pipefail

PROJ="${SRC:-/home/z/my-project}"   # 源仓库（可指向融合克隆，如 /tmp/fuse）
STAGE=/tmp/package-build/ShieldEar
rm -rf /tmp/package-build
mkdir -p "$STAGE"

echo "── [0/8] fail-fast：构建机前置校验 ──"
# 构建机必须已生成 Prisma 客户端（含 Windows 引擎），否则 standalone 里没有引擎
if ! ls "$PROJ/node_modules/.prisma/client/"query_engine-windows.dll.node >/dev/null 2>&1; then
  echo "✗ 构建机缺少 Windows Prisma 引擎（node_modules/.prisma/client/query_engine-windows.dll.node）"
  echo "  请先执行: npm run db:generate （prisma schema 已配置 windows binaryTarget）"
  exit 1
fi
echo "✓ Windows Prisma 引擎就绪"

echo "── [1/8] 复制 standalone 服务端（排除沙箱杂物） ──"
cd "$PROJ/.next/standalone"
mkdir -p "$STAGE/server"
rsync -a --exclude 'skills' --exclude 'repo-stage' --exclude 'download' \
  --exclude 'upload' --exclude 'tool-results' --exclude 'tests' --exclude 'scripts' \
  --exclude 'Caddyfile' --exclude 'dev.log' --exclude 'bun.lock' \
  --exclude 'eslint.config.mjs' --exclude 'tailwind.config.ts' \
  --exclude 'tsconfig.json' --exclude 'postcss.config.mjs' \
  --exclude 'components.json' --exclude 'src' --exclude 'package-lock.json' \
  --exclude '.env' --exclude '.env.*' --exclude 'docs' \
  ./ "$STAGE/server/"

echo "── [2/8] 精简 node_modules（Windows 交付） ──"
cd "$STAGE/server/node_modules"
rm -rf typescript @img sharp 2>/dev/null || true
cd "$STAGE/server/node_modules/.prisma/client"
rm -f libquery_engine-darwin-arm64.dylib.node \
      libquery_engine-debian-openssl-3.0.x.so.node \
      libquery_engine-linux-openssl-3.0.x.so.node 2>/dev/null || true
find "$STAGE/server/node_modules/@prisma/engines" -name "*.node" ! -name "*windows*" -delete 2>/dev/null || true
# Prisma WASM：仅保留 sqlite
cd "$STAGE/server/node_modules/@prisma/client/runtime"
rm -f query_engine_bg.postgresql* query_engine_bg.cockroachdb* \
      query_engine_bg.sqlserver* query_engine_bg.mysql* \
      query_compiler_bg.postgresql* query_compiler_bg.cockroachdb* \
      query_compiler_bg.sqlserver* query_compiler_bg.mysql* 2>/dev/null || true

echo "── [3/8] 精简校准音频（引擎用编译进 JS 的常量，96MB 音频仅开发期使用） ──"
rm -rf "$STAGE/server/calibration/audio" \
       "$STAGE/server/calibration/testsuite_results.json" \
       "$STAGE/server/calibration/results.json"

echo "── [4/8] 启动包装器 boot.js（自检 + 纯离线发行锁 + DATABASE_URL 绝对化） ──"
cat > "$STAGE/server/boot.js" << 'BOOTEOF'
/**
 * boot.js — 声盾便携包启动包装器（v1.3.5）
 * 职责：
 *   1. 纯离线发行锁：SHIELD_RELEASE_OFFLINE=1（云端通道在本包中永久关闭，
 *      切换接口 403，前端编译期已徽章化，不存在任何可触发的联网路径）；
 *   2. 启动自检：实际加载 Prisma 引擎 + 数据库连通 + 校准数据 + espeak 组件，
 *      任何一项失败都打印明确提示并写 STARTUP-ERROR.txt 后退出 ——
 *      杜绝"带病启动 → 页面 Internal Server Error"；
 *   3. 把相对形态的 DATABASE_URL 转为基于本目录的绝对路径；
 *   4. 固定 cwd 到本目录，保证 espeak-ng 等包内组件的相对定位；
 *   5. 加载 Next.js standalone 服务端。
 */
const path = require("path");
const fs = require("fs");
process.chdir(__dirname);

// ── 1. 纯离线发行锁 ──
process.env.SHIELD_RELEASE_OFFLINE = "1";

// ── 2. DATABASE_URL 相对→绝对（自检的 Prisma 探针需要正确路径） ──
let url = process.env.DATABASE_URL || "file:./db/custom.db";
if (url.startsWith("file:")) {
  const p = url.slice(5);
  if (!path.isAbsolute(p)) {
    process.env.DATABASE_URL = "file:" + path.resolve(__dirname, p);
  }
}

// ── 3. 启动自检 ──
function startupFail(items) {
  const line = "=".repeat(60);
  const msg =
    "\n" + line +
    "\n  [ShieldEar] STARTUP CHECK FAILED - 启动自检未通过\n" + line + "\n\n" +
    items.map((s) => "  ✗ " + s).join("\n") +
    "\n\n  处理建议：\n" +
    "  · 重新解压完整发行包（可能解压不完整或文件被杀毒软件误删，请将本文件夹加入杀毒白名单）\n" +
    "  · 若提示 DLL/模块加载失败：安装微软 VC++ 2015-2022 运行库 x64\n" +
    "    （https://aka.ms/vs/17/release/vc_redist.x64.exe ）\n" +
    "  · 从 GitHub Releases 重新下载：https://github.com/43aquarius/ShieldEar\n" +
    "  · 本提示已写入 STARTUP-ERROR.txt（位于本文件夹根目录）\n" + line + "\n";
  console.error(msg);
  try {
    fs.writeFileSync(path.join(__dirname, "..", "STARTUP-ERROR.txt"), msg.trim() + "\n");
  } catch {}
  process.exit(1);
}

async function main() {
  const problems = [];

  // 3a. Prisma 查询引擎：文件存在性（平台对应的引擎文件）
  const prismaClientDir = path.join(__dirname, "node_modules", ".prisma", "client");
  const engineExpect = {
    win32: [/^query_engine-windows\.dll\.node$/],
    linux: [/^libquery_engine-.*\.so\.node$/, /^query_engine-.*\.so\.node$/],
    darwin: [/^libquery_engine-darwin.*\.dylib\.node$/, /^query_engine-darwin.*\.node$/],
  };
  let hasEngineFile = false;
  try {
    const files = fs.readdirSync(prismaClientDir);
    const pats = engineExpect[process.platform] || [];
    hasEngineFile = files.some((f) => pats.some((p) => p.test(f)));
  } catch {}
  if (!hasEngineFile) {
    problems.push(
      "Prisma 查询引擎文件缺失（node_modules/.prisma/client，" +
        (process.platform === "win32" ? "query_engine-windows.dll.node" : "当前平台引擎") +
        "）— 案例库/存证功能将不可用（常见原因：解压不完整或杀毒软件误删）"
    );
  }

  // 3b. 数据引擎实际加载（关键：能发现 VC++ 运行库缺失、DLL 损坏等文件检查发现不了的问题）
  if (hasEngineFile) {
    try {
      const { PrismaClient } = require("@prisma/client");
      const probe = new PrismaClient();
      await probe.$queryRaw`SELECT COUNT(*) FROM DetectionCase`;
      await probe.$disconnect();
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      const hint = /dll|DLL|module|动态链接|找不到指定的模块|was not found/i.test(msg)
        ? "（疑似系统缺少微软 VC++ 2015-2022 运行库 x64：https://aka.ms/vs/17/release/vc_redist.x64.exe ）"
        : "";
      problems.push("数据引擎加载失败：" + msg.slice(0, 300) + hint);
    }
  }

  // 3c. 数据库文件
  const dbFile = path.join(__dirname, "db", "custom.db");
  if (!fs.existsSync(dbFile) || fs.statSync(dbFile).size < 4096) {
    problems.push("案例数据库缺失或损坏（server/db/custom.db）— 案例库与存证功能将不可用");
  }

  // 3d. 引擎校准数据
  const calibFile = path.join(__dirname, "calibration", "features.json");
  if (!fs.existsSync(calibFile)) {
    problems.push("检测引擎校准数据缺失（server/calibration/features.json）— 检测功能将不可用");
  }

  // 3e. espeak-ng 本地合成组件（Windows 发行包内建）
  if (process.platform === "win32") {
    const espeakExe = path.join(__dirname, "..", "espeak-ng", "espeak-ng.exe");
    if (!fs.existsSync(espeakExe)) {
      problems.push("本地合成引擎缺失（espeak-ng/espeak-ng.exe）— 现场合成挑战将不可用");
    }
  }

  if (problems.length > 0) startupFail(problems);

  // ── 4. 加载 Next.js standalone 服务端 ──
  require("./server.js");
}

main().catch((e) => {
  startupFail(["服务启动异常：" + String(e && e.message ? e.message : e).slice(0, 300)]);
});
BOOTEOF
rm -f "$STAGE/server/wrap-server.js"

echo "── [5/8] 数据库与运行时数据（以源仓库为权威，无条件覆盖） ──"
mkdir -p "$STAGE/server/db" "$STAGE/server/evidence" "$STAGE/server/calibration"
# db 无条件取源仓库（standalone 里可能残留构建期旧库，不可作为发行数据）
cp "$PROJ/db/custom.db" "$STAGE/server/db/custom.db"
[ -f "$STAGE/server/db/custom.db" ] || { echo "✗ 源仓库 db/custom.db 缺失"; exit 1; }
[ -f "$PROJ/calibration/features.json" ] || { echo "✗ calibration/features.json 缺失"; exit 1; }
cp "$PROJ/calibration/features.json" "$STAGE/server/calibration/features.json"
# 证据目录：清空后以源仓库为权威（保证与 db 记录一一对应，无孤儿文件）
rm -rf "$STAGE/server/evidence"
mkdir -p "$STAGE/server/evidence"
if [ -d "$PROJ/evidence" ]; then
  cp "$PROJ"/evidence/*.wav "$STAGE/server/evidence/" 2>/dev/null || true
fi
EV_COUNT=$(ls "$STAGE/server/evidence"/*.wav 2>/dev/null | wc -l)
echo "✓ 证据音频 $EV_COUNT 份（与种子案例一一对应）"

# v1.3.5：空库防线 — 发行包的案例库必须带种子演示数据
SEED_COUNT=$(python3 - "$STAGE/server/db/custom.db" << 'PYEOF'
import sqlite3, sys
try:
    con = sqlite3.connect(sys.argv[1])
    n = con.execute("SELECT COUNT(*) FROM DetectionCase").fetchone()[0]
    con.close()
    print(n)
except Exception:
    print(-1)
PYEOF
)
if [ "$SEED_COUNT" -lt 1 ] 2>/dev/null; then
  echo "✗ 数据库为空库（0 条案例）：请先在源仓库 seed 演示数据（scripts/seed-demo-cases.py）再打包"
  exit 1
fi
echo "✓ 案例库含 $SEED_COUNT 条种子案例"

echo "── [6/8] espeak-ng Windows 组件 ──"
mkdir -p "$STAGE/espeak-ng"
cp /tmp/msi-out/espeak-ng.exe "$STAGE/espeak-ng/espeak-ng.exe"
cp /tmp/msi-out/libespeak_ng.dll "$STAGE/espeak-ng/" 2>/dev/null || echo "（无 dll，exe 或为静态链接）"
if [ -d /tmp/msi-out/espeak-ng-data ]; then
  # 预提取布局（MSI 已解包形态）：直接整目录复制
  cp -r /tmp/msi-out/espeak-ng-data "$STAGE/espeak-ng/espeak-ng-data"
else
  # MSI 原始解包布局：非二进制文件平铺于数据目录
  mkdir -p "$STAGE/espeak-ng/espeak-ng-data"
  cd /tmp/msi-out
  for f in *; do
    case "$f" in
      *.exe|*.dll|*.msi) ;;
      *) cp -r "$f" "$STAGE/espeak-ng/espeak-ng-data/" ;;
    esac
  done
fi
[ -f "$STAGE/espeak-ng/espeak-ng.exe" ] || { echo "✗ espeak-ng.exe 缺失"; exit 1; }
[ -d "$STAGE/espeak-ng/espeak-ng-data" ] || { echo "✗ espeak-ng-data 缺失"; exit 1; }
echo "✓ espeak-ng 组件就位（$(du -sh "$STAGE/espeak-ng" | cut -f1)）"

echo "── [7/8] Node 运行时与启动脚本 ──"
cp /tmp/node.exe "$STAGE/node.exe"
cp "$PROJ/scripts/package-files/START-ShieldEar.bat" "$STAGE/"
cp "$PROJ/scripts/package-files/README.txt" "$STAGE/"

echo "── [8/8] 组装后校验与体积统计 ──"
# fail-fast：Windows 引擎必须真的在包里（防构建机状态异常导致静默缺失）
if ! ls "$STAGE/server/node_modules/.prisma/client/"query_engine-windows.dll.node >/dev/null 2>&1; then
  echo "✗ 校验失败：包内缺少 server/node_modules/.prisma/client/query_engine-windows.dll.node"
  exit 1
fi
if [ ! -f "$STAGE/server/boot.js" ]; then
  echo "✗ 校验失败：boot.js 未生成"
  exit 1
fi
echo "✓ Windows 引擎 / boot.js / 数据库 / 校准数据 全部就位"
du -sh "$STAGE"/* | sort -rh
echo "── 总计 ──"
du -sh "$STAGE"
echo "✓ 组装完成：$STAGE"
