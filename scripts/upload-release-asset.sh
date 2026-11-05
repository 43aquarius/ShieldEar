#!/usr/bin/env bash
# upload-release-asset.sh — Release 资产后台上传（断点续传 + 无限重试）
set -u
ZIP=/tmp/package-build/ShieldEar-v1.3.3-portable.zip
REL_ID=429734215
NAME=ShieldEar-v1.3.3-portable.zip
URL="https://uploads.github.com/repos/43aquarius/ShieldEar/releases/$REL_ID/assets?name=$NAME"

TOKEN=$(printf 'protocol=https\nhost=github.com\n' | git credential fill 2>/dev/null | grep '^password=' | cut -d= -f2)
[ -n "$TOKEN" ] || { echo "✗ 无法读取凭据"; exit 1; }

TOTAL=$(stat -c%s "$ZIP")
echo "[$(date +%H:%M:%S)] 开始上传 $NAME ($((TOTAL/1048576))MB)"

for i in $(seq 1 60); do
  HAVE=0
  # 查询已上传部分（通过资产 409 判定不可续传时整体重传）
  curl -s --max-time 30 -H "Authorization: Bearer $TOKEN" \
    "https://api.github.com/repos/43aquarius/ShieldEar/releases/$REL_ID/assets" \
    | python3 -c "
import json, sys
try:
    assets = json.load(sys.stdin)
    for a in assets:
        if a['name'] == '$NAME':
            print(a['size'], a['state'])
except Exception:
    pass" > /tmp/up-state.txt
  STATE=$(cat /tmp/up-state.txt)
  if echo "$STATE" | grep -q "uploaded"; then
    echo "[$(date +%H:%M:%S)] ✓ 资产已存在且完整: $STATE"
    exit 0
  fi

  # GitHub 资产上传不支持 Range 续传，失败即整体重传
  HTTP=$(curl -s --max-time 1800 -o /tmp/up-resp.json -w "%{http_code}" \
    -X POST "$URL" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/zip" \
    --data-binary "@$ZIP")
  echo "[$(date +%H:%M:%S)] 尝试 #$i → HTTP $HTTP"
  if [ "$HTTP" = "201" ]; then
    echo "✓ 上传成功"
    python3 -c "
import json
d = json.load(open('/tmp/up-resp.json'))
print('资产:', d.get('name'), '·', round(d.get('size',0)/1048576,1), 'MB ·', d.get('browser_download_url'))"
    exit 0
  fi
  head -c 300 /tmp/up-resp.json; echo
  echo "[$(date +%H:%M:%S)] 15s 后重试…"
  sleep 15
done
echo "✗ 60 次尝试后仍失败"
exit 1
