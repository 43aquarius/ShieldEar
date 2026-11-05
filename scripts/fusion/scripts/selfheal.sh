#!/usr/bin/env bash
# ============================================================
# ShieldEar 环境自愈脚本（沙箱快照恢复后自动修复）
#
# 背景：沙箱重置/快照恢复时，node_modules 中的生成物
# （node_modules/.prisma/client/*.node 引擎）不会存活，
# 导致 @prisma/client did not initialize，所有碰库路由 500，
# 前端报 "Unexpected token 'l', internal s... is not valid JSON"。
#
# 本脚本在 dev 启动前自动检查并修复，根治该问题。
# ============================================================
cd "$(dirname "$0")/.." || exit 1

# 1) 依赖整体缺失时先安装（罕见：深度重置清空 node_modules）
if [ ! -x node_modules/.bin/next ]; then
  echo "[selfheal] node_modules 缺失，执行 npm install ..."
  npm install --registry=https://registry.npmmirror.com 2>&1 | tail -3
fi

# 2) Prisma 引擎缺失时重新生成（常见：快照恢复不保留生成物）
if ! ls node_modules/.prisma/client/*.node >/dev/null 2>&1; then
  echo "[selfheal] Prisma 引擎缺失，自动重新生成 ..."
  PRISMA_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/prisma \
    node_modules/.bin/prisma generate 2>&1 | tail -2
else
  echo "[selfheal] Prisma 引擎正常"
fi

# 3) 数据库文件缺失时重建空库（Schema 已含全部表结构）
if [ ! -f db/custom.db ]; then
  echo "[selfheal] 数据库缺失，重建中 ..."
  mkdir -p db
  node_modules/.bin/prisma db push --accept-data-loss 2>&1 | tail -2
fi

echo "[selfheal] 环境自检完成"
