#!/usr/bin/env bash
# ============================================================
# push-v134.sh — v1.3.4 一键发布（等 GitHub PAT 到位后执行）
# 用法: GH_TOKEN=github_pat_xxx bash scripts/push-v134.sh
# 做四件事：
#   1. 推送 v1.3.4-pending → origin/main（fast-forward）
#   2. 打 tag v1.3.4 并推送
#   3. 创建 GitHub Release（附说明与 sha256）
#   4. 上传便携包资产（62MB，走 API，断点由 GitHub 处理）
# ============================================================
set -euo pipefail

TOKEN="${GH_TOKEN:?请提供 GitHub PAT：GH_TOKEN=github_pat_xxx bash scripts/push-v134.sh}"
REPO="43aquarius/ShieldEar"
BRANCH_TIP="$(git rev-parse v1.3.4-pending)"
ZIP="${1:-/home/z/my-project/download/ShieldEar-v1.3.4-portable.zip}"
SHA256="$(sha256sum "$ZIP" | cut -d' ' -f1)"

echo "── [1/4] 推送 main（$BRANCH_TIP）──"
git -c http.version=HTTP/1.1 push "https://x-access-token:${TOKEN}@github.com/${REPO}.git" \
  "+refs/heads/v1.3.4-pending:refs/heads/main"

echo "── [2/4] 打 tag v1.3.4 ──"
git tag -f v1.3.4 "$BRANCH_TIP"
git -c http.version=HTTP/1.1 push "https://x-access-token:${TOKEN}@github.com/${REPO}.git" \
  "refs/tags/v1.3.4"

echo "── [3/4]+[4/4] 创建 Release 并上传资产（release-upload.py，幂等可重试）──"
GH_TOKEN="${TOKEN}" python3 "$(cd "$(dirname "$0")" && pwd)/release-upload.py"

echo
echo "✓ v1.3.4 发布完成"
echo "⚠ 提醒：确认发布成功后，请到 GitHub Settings → Developer settings 撤销本 PAT"
