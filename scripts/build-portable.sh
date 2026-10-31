#!/usr/bin/env bash
# ============================================================
# build-portable.sh — v1.3.3 纯离线便携包组装（完整流水线）
# 前置：npm run build 已完成；/tmp/{node.exe, msi-out} 就位
# 产物：/tmp/package-build/ShieldEar/（Windows 交付目录）
# 注意：最终包只含 Windows Prisma 引擎；Linux 断网测试由
#       test-offline-portable.sh 临时补 debian 引擎后自行清理
# ============================================================
set -euo pipefail

PROJ="${SRC:-/home/z/my-project}"   # 源仓库（可指向融合克隆，如 /tmp/fuse）
STAGE=/tmp/package-build/ShieldEar
rm -rf /tmp/package-build
mkdir -p "$STAGE"

echo "── [1/8] 复制 standalone 服务端（排除沙箱杂物） ──"
cd "$PROJ/.next/standalone"
mkdir -p "$STAGE/server"
rsync -a --exclude 'skills' --exclude 'repo-stage' --exclude 'download' \
  --exclude 'upload' --exclude 'tool-results' --exclude 'tests' \
  --exclude 'Caddyfile' --exclude 'dev.log' --exclude 'bun.lock' \
  --exclude 'eslint.config.mjs' --exclude 'tailwind.config.ts' \
  --exclude 'tsconfig.json' --exclude 'postcss.config.mjs' \
  --exclude 'components.json' --exclude 'src' --exclude 'package-lock.json' \
  --exclude '.env' --exclude '.env.*' \
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

echo "── [4/8] 启动包装器 boot.js（DATABASE_URL 相对→绝对转换） ──"
cat > "$STAGE/server/boot.js" << 'BOOTEOF'
/**
 * boot.js — 声盾便携包启动包装器（v1.3.2）
 * 职责：
 *   1. 把相对形态的 DATABASE_URL 转为基于本目录的绝对路径
 *      （Prisma 的 SQLite 相对路径按生成时 schema 目录解析，
 *       便携包必须显式提供绝对路径才能落在本包内）；
 *   2. 固定 cwd 到本目录，保证 espeak-ng 等包内组件的相对定位；
 *   3. 加载 Next.js standalone 服务端。
 */
const path = require("path");
process.chdir(__dirname);

let url = process.env.DATABASE_URL || "file:./db/custom.db";
if (url.startsWith("file:")) {
  const p = url.slice(5);
  if (!path.isAbsolute(p)) {
    process.env.DATABASE_URL = "file:" + path.resolve(__dirname, p);
  }
}
require("./server.js");
BOOTEOF
rm -f "$STAGE/server/wrap-server.js"

echo "── [5/8] 数据库与运行时数据（standalone 缺失时从源仓库补齐） ──"
mkdir -p "$STAGE/server/db" "$STAGE/server/evidence" "$STAGE/server/calibration"
[ -f "$STAGE/server/db/custom.db" ] || cp "$PROJ/db/custom.db" "$STAGE/server/db/"
[ -f "$STAGE/server/calibration/features.json" ] || cp "$PROJ/calibration/features.json" "$STAGE/server/calibration/"
if [ -d "$PROJ/evidence" ] && [ -z "$(ls -A "$STAGE/server/evidence" 2>/dev/null)" ]; then
  cp "$PROJ"/evidence/*.wav "$STAGE/server/evidence/" 2>/dev/null || true
fi
[ -f "$STAGE/server/db/custom.db" ] || { echo "✗ db/custom.db 缺失"; exit 1; }
[ -f "$STAGE/server/calibration/features.json" ] || { echo "✗ calibration/features.json 缺失"; exit 1; }

echo "── [6/8] espeak-ng Windows 组件 ──"
mkdir -p "$STAGE/espeak-ng/espeak-ng-data"
cp /tmp/msi-out/espeak_ng.exe "$STAGE/espeak-ng/espeak-ng.exe"
cp /tmp/msi-out/libespeak_ng.dll "$STAGE/espeak-ng/" 2>/dev/null || echo "（无 dll，exe 或为静态链接）"
cd /tmp/msi-out
for f in *; do
  case "$f" in
    *.exe|*.dll|*.msi) ;;
    *) cp -r "$f" "$STAGE/espeak-ng/espeak-ng-data/" ;;
  esac
done

echo "── [7/8] Node 运行时与启动脚本 ──"
cp /tmp/node.exe "$STAGE/node.exe"
cp "$PROJ/scripts/fusion/scripts/package-files/START-ShieldEar.bat" "$STAGE/"
cp "$PROJ/scripts/fusion/scripts/package-files/README.txt" "$STAGE/"

echo "── [8/8] 体积统计 ──"
du -sh "$STAGE"/* | sort -rh
echo "── 总计 ──"
du -sh "$STAGE"
echo "✓ 组装完成：$STAGE"
