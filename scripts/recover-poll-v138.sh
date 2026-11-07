#!/usr/bin/env bash
# recover-poll-v138.sh — 抖动鲁棒的资产恢复轮询器
# 持续尝试直到成功（最多 60 轮 × 间隔 45s ≈ 45 分钟），日志 /tmp/recover-v138.log
set -u
LOG=/tmp/recover-v138.log
for round in $(seq 1 60); do
  echo "[poll] 第 $round 轮开始 $(date +%H:%M:%S)" >> "$LOG"
  if timeout 1500 python3 /home/z/my-project/scripts/recover-build-assets-v138.py >> "$LOG" 2>&1; then
    echo "[poll] ✅ 恢复成功（第 $round 轮）" >> "$LOG"
    exit 0
  fi
  echo "[poll] 第 $round 轮失败，45s 后重试" >> "$LOG"
  sleep 45
done
echo "[poll] ✗ 60 轮全部失败" >> "$LOG"
exit 1
