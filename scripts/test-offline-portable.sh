#!/usr/bin/env bash
# ============================================================
# test-offline-portable.sh — v1.3.10 便携包断网实测
# 在无任何外网接口的网络命名空间中启动 standalone 服务端，
# 验证纯离线模式全功能可用（铁证零联网）。
# v1.3.6 关键改进：测试对象 = 解压后的交付 zip（「测什么，交付什么」）。
#   v1.3.5 事故教训：只测 stage 目录时，目录软链在 Linux 上可解析、
#   全部通过；而 zip(os.walk) 丢弃软链后的真实交付物在 Windows 上启动即崩。
# v1.3.9 新增：
#   · espeak Linux 替身注入 —— 把包内 espeak-ng.exe / espeak-ng-data
#     临时替换为系统等价物（仅测试期，交付树由 zip 重新解压而来），
#     使「应用内合成挑战 live 模式」在 Linux 断网环境可端到端验证；
#   · regress-v1310.py 专项回归（七音色互异 / live 模式 / 并发竞态 / 存证包 / 体积闸）。
# ============================================================
set -u

ZIP=/home/z/my-project/download/ShieldEar-v1.3.10-portable.zip
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

# v1.3.9：交付树平台折叠硬闸（对 zip 解压物再验一次，双保险）
python3 /home/z/my-project/scripts/verify-bundled-platform.py "$STAGE/server" || {
  echo "✗ 交付 zip 内产物未通过平台折叠硬闸"; exit 1; }

# 回归脚本副本（netns 内 BASE 一致，走 localhost）
cp /home/z/my-project/scripts/regress-all-apis.py /tmp/regress-offline.py
cp /home/z/my-project/scripts/regress-v1310.py /tmp/regress-v1310.py

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

# ── v1.3.9：espeak Linux 替身（仅测试期）──
# 目的：让「应用按 espeak-ng.exe 文件名探测包内组件 + 注入 ESPEAK_DATA_PATH」
# 的 Windows 代码路径在 Linux 上可执行验证。系统 espeak-ng 1.52.0 与包内
# Windows 版同源（数据目录 103/118 文件逐字节一致，见 rebuild-espeak-from-msi.py）。
ESPEAK_DIR="$STAGE/espeak-ng"
# 注意：cp 覆盖已存在文件时保留目标权限（zip 解压为 664，无执行位），
# 必须 chmod，否则 execFile EACCES → 探测回落系统 PATH，live 验证失真。
cp /usr/bin/espeak-ng "$ESPEAK_DIR/espeak-ng.exe" 2>/dev/null || echo "[test] ⚠ espeak 替身注入失败（live 模式验证将失效）"
chmod 755 "$ESPEAK_DIR/espeak-ng.exe"
rm -rf "$ESPEAK_DIR/espeak-ng-data"
cp -r /usr/lib/x86_64-linux-gnu/espeak-ng-data "$ESPEAK_DIR/espeak-ng-data" 2>/dev/null || echo "[test] ⚠ espeak 数据替身注入失败"
echo "[test] espeak Linux 替身就位（exe + data；交付树不受影响——每次测试从 zip 重新解压）"

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
echo '════════ 断网环境全功能回归（v1.3.5 基线）════════'
python3 /tmp/regress-offline.py
RC1=\$?
echo
echo '════════ v1.3.10 专项回归（七音色互异/live/并发/存证包/体积闸）════════'
python3 /tmp/regress-v1310.py
RC2=\$?
echo
echo '════════ offline 模式标志验证 ════════'
curl -s http://127.0.0.1:3000/api/config/cloud
echo
kill \$SRV 2>/dev/null
[ \$RC1 -eq 0 ] && [ \$RC2 -eq 0 ]
"
RC=$?
echo
echo "=== 断网实测结果: $([ $RC -eq 0 ] && echo '✓ 全部通过' || echo '✗ 存在失败') ==="
echo "=== 服务端日志（末 12 行）==="
tail -12 /tmp/offline-server.log
exit $RC
