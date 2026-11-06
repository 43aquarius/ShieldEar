#!/usr/bin/env bash
# take-handbook-shots.sh — 答辩演示手册截图流水线（单命令内完成，防进程收割）
# 流程：起 dev server → 播种演示案例（若缺）→ agent-browser 截 4 张 → 关服务
# 产物：download/handbook-shots/{01-home,03-verdict,03b-spectrogram,04-cases}.png
# 踩坑记录（2026-11-06 实测）：
#   1) 就绪探测勿用 `curl ... || echo 000`：连接失败时 -w 已输出 000，再拼接成
#      000000 ≠ "000"，首轮即假就绪 → 播种撞死库 → 全链雪崩；
#   2) cleanup 里 agent-browser close 在守护进程未起时会无限挂死 → 必须 timeout 包裹；
#   3) 非交互 shell 后台任务与脚本同进程组，组杀会误杀自身 → setsid 独立会话再组杀。
set -uo pipefail
cd /home/z/my-project
SHOT=download/handbook-shots
mkdir -p "$SHOT"

echo "── [1/5] 启动 dev server（predev 自愈先行）──"
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 2
setsid npm run dev > /tmp/dev-shots.log 2>&1 &
DEV_PID=$!
cleanup() {
  timeout 10 agent-browser close >/dev/null 2>&1 || true
  kill -TERM -- -$DEV_PID 2>/dev/null
  sleep 2
  kill -KILL -- -$DEV_PID 2>/dev/null
  pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
}
trap cleanup EXIT

READY=0
for i in $(seq 1 60); do
  CODE=$(curl -s --max-time 4 -o /dev/null -w "%{http_code}" http://localhost:3000/api/selfcheck 2>/dev/null)
  if [ -n "$CODE" ] && [ "$CODE" != "000" ]; then
    READY=1; echo "✓ 服务就绪（selfcheck HTTP $CODE · 约 $((i*5))s）"; break
  fi
  sleep 5
done
if [ "$READY" != "1" ]; then echo "✗ 服务 300s 未就绪，dev 日志尾部："; tail -30 /tmp/dev-shots.log; exit 1; fi

echo "── [2/5] 播种演示案例（若不足 4 条）──"
N_CASE=$(python3 -c "import sqlite3;print(sqlite3.connect('db/custom.db').execute('SELECT COUNT(*) FROM DetectionCase').fetchone()[0])" 2>/dev/null || echo 0)
if [ "$N_CASE" -lt 4 ]; then
  python3 scripts/seed-demo-cases.py || { echo "✗ 播种失败"; exit 1; }
else
  echo "· 已有 $N_CASE 条案例，跳过播种"
fi

echo "── [3/5] 截图 1/4：开屏首页 Hero ──"
agent-browser set viewport 1280 800
agent-browser open http://localhost:3000
agent-browser wait --text "AI 语音诈骗实时鉴伪反诈平台" --timeout 120000 \
  || echo "⚠ 页头文本未出现，继续尝试截图"
agent-browser wait --load networkidle --timeout 30000 >/dev/null 2>&1 || true
agent-browser wait 4500
agent-browser screenshot "$SHOT/01-home.png"

echo "── [4/5] 截图 2-3/4：合成挑战 → 判决剧场 → 时频取证 ──"
agent-browser find role tab click --name "合成挑战" \
  || agent-browser find text "合成挑战" click
agent-browser wait 2000
agent-browser find role button click --name "现场合成并检测" \
  || agent-browser find text "现场合成并检测" click
agent-browser wait --text "深伪检出" --timeout 90000 \
  || { echo "⚠ 印章文本未出现（可能判为其他档位），等待后继续"; agent-browser wait 25000; }
agent-browser wait 7000
agent-browser eval "(()=>{const el=[...document.querySelectorAll('div,span')].find(e=>e.childElementCount===0&&e.textContent.trim()==='深伪检出');if(el){el.scrollIntoView({block:'center',behavior:'instant'});return 'scrolled'}return 'notfound'})()"
agent-browser wait 900
agent-browser screenshot "$SHOT/03-verdict.png"
agent-browser eval "(()=>{const el=[...document.querySelectorAll('h3,div,span')].find(e=>e.textContent.includes('时频分析 · 取证视图'));if(el){el.scrollIntoView({block:'start',behavior:'instant'});return 'scrolled'}return 'notfound'})()"
agent-browser wait 3000
agent-browser screenshot "$SHOT/03b-spectrogram.png"

echo "── [5/5] 截图 4/4：案例库 ──"
agent-browser find role button click --name "案例库" \
  || agent-browser find text "案例库" click
agent-browser wait --load networkidle --timeout 30000 >/dev/null 2>&1 || true
agent-browser wait 3000
agent-browser screenshot "$SHOT/04-cases.png"

echo "── 校验 ──"
python3 - << 'PY'
import struct, os
ok = True
for f in ['01-home.png', '03-verdict.png', '03b-spectrogram.png', '04-cases.png']:
    p = f'download/handbook-shots/{f}'
    if not os.path.exists(p):
        print('✗', f, '缺失'); ok = False; continue
    with open(p, 'rb') as fp:
        d = fp.read(33)
    w, h = struct.unpack('>II', d[16:24])
    print(f'· {f}: {w}x{h} · {os.path.getsize(p):,} bytes')
print('ALL OK' if ok else 'INCOMPLETE')
PY
