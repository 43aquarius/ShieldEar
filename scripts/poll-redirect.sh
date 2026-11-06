#!/usr/bin/env bash
# poll-redirect.sh — 轮询两条 302 通道直到拿到新鲜签名直链（好窗口会出现）
# 产物: /tmp/asset-direct-url.txt
TOKEN="${GH_TOKEN:?}"
AID=714138096
for i in $(seq 1 100); do
  # 通道 A: github.com 主站直链
  R=$(curl -s -m 25 -o /dev/null -w "%{redirect_url}" \
    "https://github.com/43aquaris/ShieldEar/releases/download/v1.3.6/ShieldEar-v1.3.6-portable.zip" 2>/dev/null)
  if [[ "$R" == https://release-assets.githubusercontent.com/* ]]; then
    echo "$R" > /tmp/asset-direct-url.txt
    echo "✓ 通道A（github.com）第 $i 次拿到直链"; exit 0
  fi
  # 通道 B: api.github.com 资产端点（Basic 认证 + 穿透参数）
  R=$(curl -s -m 25 -o /dev/null -w "%{redirect_url}" \
    -u "43aquarius:${TOKEN}" -H "Accept: application/octet-stream" \
    "https://api.github.com/repos/43aquarius/ShieldEar/releases/assets/${AID}?_p=$i$RANDOM" 2>/dev/null)
  if [[ "$R" == https://release-assets.githubusercontent.com/* ]]; then
    echo "$R" > /tmp/asset-direct-url.txt
    echo "✓ 通道B（api 资产端点）第 $i 次拿到直链"; exit 0
  fi
  sleep 4
done
echo "✗ 100 次未拿到直链"; exit 1
