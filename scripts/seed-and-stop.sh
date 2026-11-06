#!/usr/bin/env bash
# seed-and-stop.sh — 起 dev server → 播种演示案例 → 关服务（单命令内完成，防进程收割）
set -uo pipefail
cd /home/z/my-project

echo "── [1/3] 启动 dev server（predev 自愈先行）──"
npm run dev > /tmp/dev-seed.log 2>&1 &
DEV_PID=$!
trap 'kill -TERM -$(ps -o pgid= $DEV_PID | tr -d " ") 2>/dev/null; sleep 2; kill -KILL -$(ps -o pgid= $DEV_PID | tr -d " ") 2>/dev/null' EXIT

READY=0
for i in $(seq 1 90); do
  if curl -s --max-time 3 -o /dev/null http://localhost:3000/api/selfcheck 2>/dev/null; then
    # selfcheck 返回 200 即 API 可用（可能返回 500 也算服务已起，再探一次页面）
    CODE=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" http://localhost:3000/api/selfcheck 2>/dev/null || echo 000)
    if [ "$CODE" != "000" ]; then
      READY=1
      echo "✓ 服务就绪（${i}0 秒内 · selfcheck HTTP $CODE）"
      break
    fi
  fi
  sleep 10
done
if [ "$READY" != "1" ]; then
  echo "✗ 服务 900 秒内未就绪，dev 日志尾部："
  tail -30 /tmp/dev-seed.log
  exit 1
fi

echo "── [2/3] 播种 4 条演示案例 ──"
python3 scripts/seed-demo-cases.py
SEED_RC=$?

echo "── [3/3] 校验 ──"
N_CASE=$(python3 -c "import sqlite3; print(sqlite3.connect('db/custom.db').execute('SELECT COUNT(*) FROM DetectionCase').fetchone()[0])")
N_EV=$(ls evidence/*.wav 2>/dev/null | wc -l)
echo "案例数: $N_CASE · 证据 WAV: $N_EV"
python3 - << 'PYEOF'
import sqlite3, hashlib, os
con = sqlite3.connect('db/custom.db')
rows = con.execute("SELECT caseNo, overallRisk, syntheticRatio FROM DetectionCase ORDER BY caseNo").fetchall()
for r in rows:
    print('  ', r)
con.close()
PYEOF
exit $SEED_RC
