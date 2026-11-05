#!/bin/bash
CFG=/etc/.z-ai-config
BASE=$(python3 -c "import json; print(json.load(open('$CFG'))['baseUrl'])")
KEY=$(python3 -c "import json; print(json.load(open('$CFG'))['apiKey'])")
TOKEN=$(python3 -c "import json; print(json.load(open('$CFG')).get('token',''))")
BODY='{"input":"通道恢复探测","voice":"tongtong","speed":1.0,"response_format":"wav","stream":false}'
echo "target: $BASE/audio/tts"
curl -s -o /tmp/probe-body.bin -w "HTTP=%{http_code} size=%{size_download} time=%{time_total}s\n" \
  -X POST "$BASE/audio/tts" \
  -H "Content-Type: application/json" \
  -H "User-Agent: ShieldEar-Server/1.0" \
  -H "Accept: */*" \
  -H "Authorization: Bearer $KEY" \
  -H "X-Z-AI-From: Z" \
  -H "X-Token: $TOKEN" \
  -d "$BODY" --max-time 60
head -c 60 /tmp/probe-body.bin 2>/dev/null | od -c | head -2
