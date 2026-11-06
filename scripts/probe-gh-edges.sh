#!/usr/bin/env bash
# probe-gh-edges.sh — 探测各 GitHub 边缘 IP 的可用性（绕过损坏的 DNS 路由）
# 对每个候选 IP 测试：API /repos、API /releases、git info/refs（带 token）
TOKEN="${GH_TOKEN:?need GH_TOKEN}"
REPO_PATH="repos/43aquaris/ShieldEar"

API_IPS="20.205.243.168 140.82.112.5 140.82.113.5 140.82.114.5 140.82.115.5 140.82.116.5 140.82.121.5"
WEB_IPS="20.205.243.166 140.82.112.3 140.82.113.3 140.82.114.3 140.82.116.3 140.82.121.3"

echo "════ api.github.com 边缘探测 ════"
for ip in $API_IPS; do
  R1=$(curl -s -m 10 --resolve api.github.com:443:$ip -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" "https://api.github.com/$REPO_PATH" 2>/dev/null || echo 000)
  R2=$(curl -s -m 10 --resolve api.github.com:443:$ip -o /dev/null -w "%{http_code}" \
    "https://api.github.com/$REPO_PATH/releases" 2>/dev/null || echo 000)
  echo "api $ip: /repos=$R1 /releases(unauth)=$R2"
done

echo
echo "════ github.com（git 智能协议）边缘探测 ════"
for ip in $WEB_IPS; do
  R3=$(curl -s -m 10 --resolve github.com:443:$ip -o /dev/null -w "%{http_code}" \
    "https://github.com/43aquaris/ShieldEar.git/info/refs?service=git-upload-pack" 2>/dev/null || echo 000)
  R4=$(curl -s -m 10 --resolve github.com:443:$ip -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" \
    "https://github.com/43aquaris/ShieldEar.git/info/refs?service=git-upload-pack" 2>/dev/null || echo 000)
  echo "web $ip: info/refs(unauth)=$R3 info/refs(token)=$R4"
done
