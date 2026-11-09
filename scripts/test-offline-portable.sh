#!/usr/bin/env bash
# ============================================================
# test-offline-portable.sh — v1.3.12 便携包断网实测
# 在无任何外网接口的网络命名空间中启动 standalone 服务端，
# 验证纯离线模式全功能可用（铁证零联网）。
# v1.3.6 关键改进：测试对象 = 解压后的交付 zip（「测什么，交付什么」）。
#   v1.3.5 事故教训：只测 stage 目录时，目录软链在 Linux 上可解析、
#   全部通过；而 zip(os.walk) 丢弃软链后的真实交付物在 Windows 上启动即崩。
# v1.3.12 变更（引擎 v2.0.0-calibrated 学术增强）：
#   · 专项回归换用 regress-v1312.py（引擎 v2.0 口径：版本号/11 维特征
#     剖面/新特征键在场 + v1.3.11 起全部防回归）；
#   · 检测引擎新增三维权韵律特征（f0Std/shimmer/envMod45，宽带计分）；
#   · 修复窄带信道判定潜伏缺陷（3.25kHz 幅度占比 → 3.5kHz 功率占比，
#     v1 以来窄带评分路径从未真正触发）。
# v1.3.11 变更（合成挑战功能整体移除）：
#   · 删除 espeak Linux 替身注入 —— 包内已无本地合成组件，无需替身；
#   · 专项回归换用 regress-v1311.py（合成通道下线 404 / chunk 零残留 /
#     自检四项口径 / 并发竞态 / 存证包 ZIP / 体积闸）；
#   · 原「offline 模式标志验证」curl /api/config/cloud 一步随路由删除
#     退役（404 断言已并入 regress-v1311.py 第 1 节）。
# ============================================================
set -u

ZIP=/home/z/my-project/download/ShieldEar-v1.3.12-portable.zip
STAGE=/tmp/zip-verify/ShieldEar
NODE=$(which node)

# ── 解压交付 zip 到干净目录（模拟评审机解压动作） ──
rm -rf /tmp/zip-verify
mkdir -p /tmp/zip-verify
[ -f "$ZIP" ] || { echo "✗ 交付 zip 不存在: $ZIP（先跑 build-portable.sh + 打 zip）"; exit 1; }
python3 - "$ZIP" << 'PYEOF'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
z.extractall("/tmp/zip-verify")
print(f"[verify] zip 解压完成（{len(z.namelist())} 个成员）")
PYEOF
[ -f "$STAGE/server/boot.js" ] || { echo "✗ 解压后缺少 server/boot.js"; exit 1; }
[ -f "$STAGE/node.exe" ] || { echo "✗ 解压后缺少 node.exe"; exit 1; }
# v1.3.6 核心断言：Turbopack 哈希外部依赖必须是实体目录（而非被 zip 丢失的软链）
HASHDIRS=$(ls -d "$STAGE/server/.next/node_modules/@prisma/"client-* 2>/dev/null || true)
[ -n "$HASHDIRS" ] || { echo "✗ 解压后缺少 server/.next/node_modules/@prisma/client-<hash> 实体目录（v1.3.5 事故特征）"; exit 1; }
echo "[verify] 哈希外部依赖实体目录存在: $(basename $HASHDIRS)"

# 平台折叠硬闸（v1.3.11 收敛口径：chunk 不得有 process.platform 比较残留；
# 对 zip 解压物再验一次，双保险）
python3 /home/z/my-project/scripts/verify-bundled-platform.py "$STAGE/server" || {
  echo "✗ 交付 zip 内产物未通过平台折叠硬闸"; exit 1; }

# 回归脚本副本（netns 内 BASE 一致，走 localhost）
cp /home/z/my-project/scripts/regress-all-apis.py /tmp/regress-offline.py
cp /home/z/my-project/scripts/regress-v1312.py /tmp/regress-v1312.py

# ── 临时补 Linux 引擎到包内（仅测试期；包交付 Windows 引擎） ──
LINUX_ENGINE=$(ls /home/z/my-project/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node 2>/dev/null || true)
if [ -z "$LINUX_ENGINE" ]; then
  LINUX_ENGINE=$(ls /home/z/my-project/node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node 2>/dev/null || true)
fi
if [ -n "$LINUX_ENGINE" ]; then
  cp "$LINUX_ENGINE" "$STAGE/server/node_modules/.prisma/client/"
  echo "[test] 已临时补入 Linux 引擎（测后删除）: $(basename "$LINUX_ENGINE")"
else
  echo "[test] ⚠ 未找到 debian 引擎，netns 内 Prisma 将无法初始化"
fi

cleanup_engine() {
  rm -f "$STAGE/server/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node"
}
trap cleanup_engine EXIT

unshare -rn bash -c "
set -u
ip link set lo up
echo '[netns] 网络接口列表（应只有 lo）:'
ip addr show | grep -E '^[0-9]+:' || true

cd $STAGE/server
export DATABASE_URL=file:./db/custom.db
export PORT=3000
export HOSTNAME=127.0.0.1
$NODE boot.js > /tmp/offline-server.log 2>&1 &
SRV=\$!
echo '[netns] 服务端 PID:' \$SRV

# 等待就绪
for i in \$(seq 1 30); do
  if curl -s -o /dev/null --max-time 2 http://127.0.0.1:3000 2>/dev/null; then
    echo \"[netns] 服务就绪（第 \${i} 次探测）\"
    break
  fi
  sleep 1
done

echo
echo '════════ 断网环境全功能回归（v1.3.12 基线）════════'
python3 /tmp/regress-offline.py
RC1=\$?
echo
echo '════════ v1.3.12 专项回归（引擎v2.0口径/合成通道下线/并发/存证包/体积闸）════════'
python3 /tmp/regress-v1312.py
RC2=\$?
kill \$SRV 2>/dev/null
[ \$RC1 -eq 0 ] && [ \$RC2 -eq 0 ]
"
RC=$?
echo
echo "=== 断网实测结果: $([ $RC -eq 0 ] && echo '✓ 全部通过' || echo '✗ 存在失败') ==="
echo "=== 服务端日志（末 12 行）==="
tail -12 /tmp/offline-server.log
exit $RC
