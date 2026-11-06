#!/usr/bin/env bash
# restore-prisma-engines.sh — 沙箱重置后手动恢复 Prisma 引擎二进制
# 背景：Node fetch 在本沙箱挂起（happy-eyeballs 缺陷），prisma generate 的引擎下载
#       会无限卡死；curl 正常。本脚本用 curl 从官方 binaries.prisma.sh 下载并解压就位。
# 版本锚定：node_modules/@prisma/engines-version 的 enginesVersion（零漂移）
# 就位规则（读 @prisma/fetch-engine 源码得出）：
#   - CLI 引擎 → node_modules/@prisma/engines/{name}-{target}[.so.node]
#   - 客户端引擎（binaryTargets= native/windows/darwin-arm64）→ node_modules/.prisma/client/
#   - 原生引擎会被 require() 验版本号，故必须下载精确 hash 的官方构建
set -euo pipefail
cd /home/z/my-project

H=$(node -e "console.log(require('./node_modules/@prisma/engines-version/package.json').prisma.enginesVersion)")
BASE="https://binaries.prisma.sh/all_commits/$H"
TMP=/tmp/prisma-engines
mkdir -p "$TMP"

dl() { # dl <url-path> <out>
  echo "↓ $1"
  curl -fL --retry 4 --max-time 300 -o "$TMP/$2" "$BASE/$1"
}

dl "debian-openssl-3.0.x/libquery_engine.so.node.gz"  "lq-debian.so.node.gz"
dl "debian-openssl-3.0.x/schema-engine.gz"            "schema-engine-debian.gz"
dl "windows/query_engine.dll.node.gz"                 "lq-windows.dll.node.gz"
dl "darwin-arm64/libquery_engine.dylib.node.gz"       "lq-darwin.dylib.node.gz"

# 三个就位位置（分别对应 CLI / generate 客户端生成器 / 运行时解析）：
#   node_modules/@prisma/engines/  — CLI（db push 等）
#   node_modules/prisma/           — prisma generate 的引擎校验（debug 日志实测）
#   node_modules/.prisma/client/   — 生成的客户端运行时 require
mkdir -p node_modules/@prisma/engines node_modules/.prisma/client node_modules/prisma
gunzip -c "$TMP/lq-debian.so.node.gz"    > node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node
gunzip -c "$TMP/schema-engine-debian.gz" > node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x
chmod +x node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x
gunzip -c "$TMP/lq-debian.so.node.gz"    > node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node
gunzip -c "$TMP/lq-windows.dll.node.gz"  > node_modules/.prisma/client/query_engine-windows.dll.node
gunzip -c "$TMP/lq-darwin.dylib.node.gz" > node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node
cp node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node node_modules/prisma/
cp node_modules/.prisma/client/query_engine-windows.dll.node              node_modules/prisma/
cp node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node    node_modules/prisma/

echo "── 就位清单 ──"
ls -la node_modules/@prisma/engines/*.node node_modules/@prisma/engines/schema-engine-* node_modules/.prisma/client/*.node 2>/dev/null

echo "── 原生引擎版本自验（fetch-engine 同款 require 探针）──"
node -e "
const v = require('./node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node').version();
if (!v.commit.startsWith('$H'.slice(0, 12))) { console.error('✗ commit 不匹配:', v.commit); process.exit(1); }
console.log('✓ libquery-engine commit', v.commit);
"
node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x --version | head -1
echo "✓ 引擎恢复完成"
