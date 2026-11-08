#!/usr/bin/env bash
# push-v1310.sh — v1.3.10 一键发版（数字 ID 路由全流程）
# 用法: GH_TOKEN=github_pat_xxx bash scripts/push-v1310.sh
#   1. Git Data API 复刻 3 个提交（blob 逐个校验 + 树 SHA 一致）
#   2. PATCH main（按树比对快进）→ 附注标签 v1.3.10
#   3. Release 创建/复用 → 资产上传（4 次重试）→ CDN 回读 SHA-256 三方核验
set -euo pipefail
: "${GH_TOKEN:?请提供 GitHub PAT：GH_TOKEN=github_pat_xxx bash scripts/push-v1310.sh}"
exec python3 "$(dirname "$0")/api-push-v1310.py"
