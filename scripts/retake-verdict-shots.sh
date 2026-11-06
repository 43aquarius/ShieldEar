#!/usr/bin/env bash
# retake-verdict-shots.sh — 补拍判决剧场/时频取证/案例库三张（修正滚动定位）
# 修正点（对照首轮失败的复盘）：
#   1) 印章文本匹配：HIGH 档是「疑似合成」而非「深伪检出」→ 四档文本全枚举
#   2) 滚动选择器：querySelectorAll 文档序先命中外层容器 → 限制 h3 / 叶子节点
#   3) 案例库先拍（保持 4 条种子案例的干净画面），挑战案例拍完即清
set -uo pipefail
cd /home/z/my-project
SHOT=download/handbook-shots

pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 2
setsid npm run dev > /tmp/dev-shots2.log 2>&1 &
DEV_PID=$!
cleanup() {
  timeout 10 agent-browser close >/dev/null 2>&1 || true
  kill -TERM -- -$DEV_PID 2>/dev/null; sleep 2; kill -KILL -- -$DEV_PID 2>/dev/null
  pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
}
trap cleanup EXIT

READY=0
for i in $(seq 1 60); do
  CODE=$(curl -s --max-time 4 -o /dev/null -w "%{http_code}" http://localhost:3000/api/selfcheck 2>/dev/null)
  if [ -n "$CODE" ] && [ "$CODE" != "000" ]; then READY=1; echo "✓ 服务就绪（HTTP $CODE · 约 $((i*5))s）"; break; fi
  sleep 5
done
[ "$READY" = "1" ] || { echo "✗ 服务未就绪"; tail -20 /tmp/dev-shots2.log; exit 1; }

echo "── [1/4] 清理挑战案例，恢复 4 条种子 ──"
python3 -c "
import sqlite3
con = sqlite3.connect('db/custom.db')
n = con.execute(\"DELETE FROM DetectionCase WHERE sourceType='TTS'\").rowcount
con.commit(); con.close()
print(f'· 已删除 {n} 条挑战案例')"

echo "── [2/4] 案例库（4 条种子案例）──"
agent-browser set viewport 1280 800
agent-browser open http://localhost:3000
agent-browser wait --text "AI 语音诈骗实时鉴伪反诈平台" --timeout 120000 || true
agent-browser find role button click --name "案例库" || agent-browser find text "案例库" click
agent-browser wait --load networkidle --timeout 30000 >/dev/null 2>&1 || true
agent-browser wait 3000
agent-browser screenshot "$SHOT/04-cases.png"

echo "── [3/4] 合成挑战 → 判决剧场 ──"
agent-browser find role button click --name "检测工作台" || agent-browser find text "检测工作台" click
agent-browser wait 1500
agent-browser find role tab click --name "合成挑战" || agent-browser find text "合成挑战" click
agent-browser wait 2000
agent-browser find role button click --name "现场合成并检测" || agent-browser find text "现场合成并检测" click
agent-browser wait --text "时频分析" --timeout 90000 || { echo "⚠ 结果面板未出现"; agent-browser wait 25000; }
agent-browser wait 7000
agent-browser eval "(()=>{const texts=['深伪检出','疑似合成','存在可疑','真人语音'];const el=[...document.querySelectorAll('div,span')].find(e=>e.childElementCount===0&&texts.includes(e.textContent.trim()));if(el){el.scrollIntoView({block:'center',behavior:'instant'});return 'stamp='+el.textContent.trim()}return 'notfound'})()"
agent-browser wait 900
agent-browser screenshot "$SHOT/03-verdict.png"

echo "── [4/4] 时频取证视图 ──"
agent-browser eval "(()=>{const el=[...document.querySelectorAll('h3')].find(e=>e.textContent.includes('时频分析'));if(el){el.scrollIntoView({block:'start',behavior:'instant'});return 'scrolled'}return 'notfound'})()"
agent-browser wait 3000
agent-browser screenshot "$SHOT/03b-spectrogram.png"

echo "── 收尾：清理本次挑战案例 ──"
python3 -c "
import sqlite3
con = sqlite3.connect('db/custom.db')
n = con.execute(\"DELETE FROM DetectionCase WHERE sourceType='TTS'\").rowcount
con.commit(); con.close()
print(f'· 已删除 {n} 条挑战案例，案例库回到种子状态')"

python3 - << 'PY'
import struct, os
for f in ['03-verdict.png', '03b-spectrogram.png', '04-cases.png']:
    p = f'download/handbook-shots/{f}'
    with open(p, 'rb') as fp:
        d = fp.read(33)
    w, h = struct.unpack('>II', d[16:24])
    print(f'· {f}: {w}x{h} · {os.path.getsize(p):,} bytes')
PY
