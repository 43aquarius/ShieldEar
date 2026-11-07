#!/usr/bin/env bash
# ============================================================
# test-offline-portable.sh — v1.3.8 便携包断网实测
# 在无任何外网接口的网络命名空间中启动 standalone 服务端，
# 验证纯离线模式全功能可用（铁证零联网）。
# v1.3.6 关键改进：测试对象 = 解压后的交付 zip（「测什么，交付什么」）。
#   v1.3.5 事故教训：只测 stage 目录时，目录软链在 Linux 上可解析、
#   全部通过；而 zip(os.walk) 丢弃软链后的真实交付物在 Windows 上启动即崩。
# ============================================================
set -u

ZIP=/home/z/my-project/download/ShieldEar-v1.3.8-portable.zip
STAGE=/tmp/zip-verify/ShieldEar
NODE=$(which node)

# ── 解压交付 zip 到干净目录（模拟评审机解压动作） ──
rm -rf /tmp/zip-verify
mkdir -p /tmp/zip-verify
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

# 回归脚本副本（netns 内 BASE 一致，走 localhost）
# 注意：必须用主脚本（动态最新案号，8a61d31 修复）；
#       scripts/fusion/ 下的暂存副本仍是硬编码旧案号，会误报存证 404。
cp /home/z/my-project/scripts/regress-all-apis.py /tmp/regress-offline.py

# ── 临时补 Linux 引擎到包内（仅测试期；包交付 Windows 引擎） ──
# 说明：build-portable.sh 第 2/8 步删除了非 Windows 引擎以保证交付体积，
#       Linux netns 内用本机 node 跑同构 standalone 需临时补回 debian 引擎；
#       测试结束后删除，交付树恢复纯 Windows 形态。
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
# （v1.3.3 起默认即纯离线：不设 SHIELD_TTS_ONLINE）
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
echo '════════ 断网环境全功能回归 ════════'
python3 /tmp/regress-offline.py
RC=\$?
echo
echo '════════ offline 模式标志验证 ════════'
curl -s http://127.0.0.1:3000/api/config/cloud
echo
kill \$SRV 2>/dev/null
exit \$RC
"
RC=$?
echo
echo "=== 断网实测结果: $([ $RC -eq 0 ] && echo '✓ 全部通过' || echo '✗ 存在失败') ==="
echo "=== 服务端日志（末 12 行）==="
tail -12 /tmp/offline-server.log
exit $RC
