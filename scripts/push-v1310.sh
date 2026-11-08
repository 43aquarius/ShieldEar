#!/usr/bin/env bash
# push-v1310.sh — v1.3.10 一键发版（数字 ID 路由全流程）
# 用法: GH_TOKEN=github_pat_xxx bash scripts/push-v1310.sh
#   1. Git Data API 复刻 835f293(v1.3.9 远端基座) 之后的全部本地提交
#      （blob 逐个校验 + 树 SHA 一致性 + 同树异形快进）
#   2. PATCH main → 附注标签 v1.3.10
#   3. Release 创建/复用 → 资产上传（4 次重试）→ CDN 回读 SHA-256 三方核验
set -euo pipefail
: "${GH_TOKEN:?请提供 GitHub PAT：GH_TOKEN=github_pat_xxx bash scripts/push-v1310.sh}"

BASE=835f293   # v1.3.9 本地基座（远端 main 与之同树异形）
cd "$(dirname "$0")/.."

# 动态枚举待推送提交（保持历史顺序）
mapfile -t COMMITS < <(git rev-list --reverse "${BASE}..HEAD")
[ "${#COMMITS[@]}" -ge 1 ] || { echo "✗ ${BASE}..HEAD 无提交"; exit 1; }
echo "待推送 ${#COMMITS[@]} 个提交: ${COMMITS[*]}"

exec python3 scripts/api-push-v1310.py "${COMMITS[@]}"
