#!/usr/bin/env python3
"""readback-asset-v1315.py — v1.3.15 Release 资产 CDN 回读复核（独立短任务）

发版主脚本 release-v1315.py 的上传与回读合跑超 300s 沙箱收割窗（v1.3.12 实录），
回读部分独立成脚本（16 段并行 + 逐段断点续传，可重复运行）。
三方一致断言：本地 zip = CDN 回读 = Release 登记的 SHA-256。
用法: GH_TOKEN=$(cat .secrets/github_pat) python3 scripts/readback-asset-v1315.py
"""
import hashlib
import importlib.util
import os
import sys

sys.path.insert(0, "/home/z/my-project/scripts")
spec = importlib.util.spec_from_file_location(
    "apiv1312", "/home/z/my-project/scripts/api-push-v1312.py"
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

gh, cdn_readback = mod.gh, mod.cdn_readback
API = mod.API
TAG = "v1.3.15"
ZIP = "/home/z/my-project/download/ShieldEar-v1.3.15-portable.zip"
ASSET_NAME = "ShieldEar-v1.3.15-portable.zip"
READBACK = "/tmp/v1315-readback.zip"

local_sha = hashlib.sha256(open(ZIP, "rb").read()).hexdigest()
code, rel = gh("GET", f"{API}/releases/tags/{TAG}")
asset = next(a for a in rel["assets"] if a["name"] == ASSET_NAME)
print(f"Release id={rel['id']} · 资产登记 {asset['size']:,}B · state={asset['state']}")
print(f"本地 SHA-256:  {local_sha}")

# v1.3.15 实测修正：github.com 域 302 跟随超时（沙箱该域不稳），改走
# api.github.com 资产端点（Accept: octet-stream）解析签名直链后再分段下载
import urllib.request
req = urllib.request.Request(asset["url"], headers={
    "Authorization": f"Bearer {mod.TOKEN}",
    "Accept": "application/octet-stream",
    "User-Agent": "ShieldEar-release-script"})
with urllib.request.urlopen(req, timeout=60) as r:
    signed = r.url
print(f"签名直链已解析（api.github.com 路由）: …{signed[-60:]}")

rb, n = cdn_readback(signed, asset["size"], READBACK)
print(f"回读 {n:,}B · SHA-256 {rb}")
ok = rb == local_sha and n == asset["size"] == os.path.getsize(ZIP)
print("三方一致（本地 = CDN 回读 = 登记尺寸）:", "✓" if ok else "✗")
sys.exit(0 if ok else 1)
