#!/usr/bin/env bash
# fetch-zip-loop.sh — 顽强续传远程 zip 到目标大小或超时
# 用法: fetch-zip-loop.sh <url> <out> <target_bytes> [max_seconds]
URL="$1"; OUT="$2"; TARGET="$3"; MAXS="${4:-5400}"
start=$(date +%s)
while :; do
  sz=$(stat -c%s "$OUT" 2>/dev/null || echo 0)
  [ "$sz" -ge "$TARGET" ] && { echo "DONE size=$sz"; break; }
  now=$(date +%s); el=$((now - start))
  [ "$el" -ge "$MAXS" ] && { echo "TIMEOUT size=$sz"; break; }
  wget -c -q --tries=1 --timeout=90 -O "$OUT" "$URL" 2>/dev/null
  sleep 2
done
