#!/usr/bin/env python3
"""patch-v135-release.py — 在 v1.3.5 Release 说明顶部加修复指引横幅
用法: GH_TOKEN=xxx python3 scripts/patch-v135-release.py
"""
import json, os, sys, urllib.request

TOKEN = os.environ["GH_TOKEN"]
REPO = "43aquarius/ShieldEar"
API = "https://api.github.com/repos/43aquarius/ShieldEar/releases/tags/v1.3.5"
# PATCH 必须走数字 ID 端点（tags 端点仅支持 GET）

def call(url, data=None, method=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data else None,
                                 headers={"Authorization": f"Bearer {TOKEN}",
                                          "User-Agent": "shield-release",
                                          "Accept": "application/vnd.github+json"},
                                 method=method or ("PATCH" if data else "GET"))
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

rel = call(API)
old_body = rel.get("body") or ""
banner = ("> ⚠️ **本版便携包在 Windows 上存在启动缺陷**（所有走数据库的接口 500），"
          "已由 **[v1.3.6](https://github.com/43aquarius/ShieldEar/releases/tag/v1.3.6)** 修复。\n"
          "> 请下载 v1.3.6 替换使用；根因分析与修复方案见 v1.3.6 Release 说明。\n\n")
if "v1.3.6" in old_body:
    print("[patch] 已含横幅，跳过")
    sys.exit(0)
call(f"https://api.github.com/repos/{REPO}/releases/{rel['id']}", data={"body": banner + old_body}, method="PATCH")
print("[patch] ✓ v1.3.5 Release 说明已加修复指引横幅")
