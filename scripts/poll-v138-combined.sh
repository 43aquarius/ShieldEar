#!/usr/bin/env bash
# poll-v138-combined.sh — git 分支推送 × REST Release 创建 双线轮询
# 背景：本仓库 github.com git 端点与 api.github.com REST 仓库解析均处于
# 「好/坏窗口分钟级交替」的故障态（GraphQL 通道恒正常，tag v1.3.8 已建）。
# 两条恢复线，谁先通谁生效：
#   A 线：git push refs/heads/release-v138（推上即触发 Actions 代建 Release）
#   B 线：REST POST /repos/.../releases（release-v138-rest.py 的建+传）
# 终态：GraphQL release(tagName:"v1.3.8") 非 null
set -u
cd /home/z/my-project
TOKEN="${GH_TOKEN:?需要 GH_TOKEN}"
URL="https://x-access-token:${TOKEN}@github.com/43aquaris/ShieldEar.git"

graphql_release() {
  curl -s -m 20 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"query":"query{repository(owner:\"43aquarius\",name:\"ShieldEar\"){release(tagName:\"v1.3.8\"){databaseId}}}}' \
    https://api.github.com/graphql | grep -q databaseId
}

for round in $(seq 1 5); do
  echo "═══ 第 $round 轮 ($(date +%H:%M:%S)) ═══"

  # ── A 线：git 推分支 ──
  OUT=$(timeout 50 git -c http.version=HTTP/1.1 push "$URL" \
    refs/heads/release-v138:refs/heads/release-v138 2>&1 | tail -2)
  echo "[A/git] $OUT"
  if echo "$OUT" | grep -qE "new branch|up to date"; then
    echo "✓✓ A 线成功：分支已推上，Actions 将代建 Release"
    exit 0
  fi

  # ── B 线：REST 建 Release（release-v138-rest.py 自带建+传资产）──
  if graphql_release; then
    echo "✓ Release 已存在（B 线此前已成功）"
    exit 0
  fi
  if timeout 360 env GH_TOKEN="$TOKEN" POLL_ATTEMPTS=3 POLL_SLEEP=15 python3 scripts/release-v138-rest.py; then
    echo "✓✓ B 线成功：Release 已建且资产已传"
    exit 0
  fi

  sleep 30
done
echo "✗ 5 轮双线轮询均未突破（可重跑本脚本续试）"
exit 1
