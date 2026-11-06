#!/usr/bin/env bash
# retake-spectrogram-shot.sh — 补拍时频取证视图（03b）
# 复盘：CardTitle 非 h3 导致选择器空；改用「印章居中后固定下滚 650px」的确定性定位
set -uo pipefail
cd /home/z/my-project
SHOT=download/handbook-shots

pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 2
setsid npm run dev > /tmp/dev-shots3.log 2>&1 &
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
  if [ -n "$CODE" ] && [ "$CODE" != "000" ]; then READY=1; echo "✓ 服务就绪（HTTP $CODE）"; break; fi
  sleep 5
done
[ "$READY" = "1" ] || { echo "✗ 服务未就绪"; tail -20 /tmp/dev-shots3.log; exit 1; }

agent-browser set viewport 1280 800
agent-browser open http://localhost:3000
agent-browser wait --text "AI 语音诈骗实时鉴伪反诈平台" --timeout 120000 || true
agent-browser find role tab click --name "合成挑战" || agent-browser find text "合成挑战" click
agent-browser wait 2000
agent-browser find role button click --name "现场合成并检测" || agent-browser find text "现场合成并检测" click
agent-browser wait --text "时频分析" --timeout 90000 || agent-browser wait 25000
agent-browser wait 7000
# 印章居中（与 03-verdict 同基准），随后固定下滚一屏到时频取证卡
agent-browser eval "(()=>{const texts=['深伪检出','疑似合成','存在可疑','真人语音'];const el=[...document.querySelectorAll('div,span')].find(e=>e.childElementCount===0&&texts.includes(e.textContent.trim()));if(el){el.scrollIntoView({block:'center',behavior:'instant'});return 'stamp='+el.textContent.trim()}return 'notfound'})()"
agent-browser wait 500
agent-browser eval "window.scrollBy(0, 650); 'scrolled+' + window.scrollY"
agent-browser wait 3500
agent-browser screenshot "$SHOT/03b-spectrogram.png"

echo "── 收尾：清理本次挑战案例 ──"
python3 -c "
import sqlite3
con = sqlite3.connect('db/custom.db')
n = con.execute(\"DELETE FROM DetectionCase WHERE sourceType='TTS'\").rowcount
con.commit(); con.close()
print(f'· 已删除 {n} 条挑战案例')"

python3 -c "
import struct, os
p = 'download/handbook-shots/03b-spectrogram.png'
with open(p, 'rb') as fp: d = fp.read(33)
w, h = struct.unpack('>II', d[16:24])
print(f'· {p}: {w}x{h} · {os.path.getsize(p):,} bytes')"
