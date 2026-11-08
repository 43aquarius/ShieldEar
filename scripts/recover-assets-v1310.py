#!/usr/bin/env python3
"""recover-assets-v1310.py — 数字 ID 路由恢复构建资产（v1.3.10）

背景：GitHub 名字路由在本环境仍假 404，recover-build-assets-v138.py 的
名字直链失效。改走数字 ID：GET /repositories/1435969436/releases →
定位 tag v1.3.9 → 资产 browser_download_url 下载完整 zip →
SHA-256 对账（v1.3.9 登记值）→ 抽取 node.exe + espeak-ng 全套。

产物（与历史布局一致）：
  /tmp/node.exe                    — Windows node 运行时（随包分发）
  /tmp/msi-out/espeak-ng.exe       — Windows espeak 主程序（PE 分析 + 随包）
  /tmp/msi-out/libespeak_ng.dll    — 连字符名 DLL
  /tmp/msi-out/espeak-ng-data/…    — 全量声库（含中文 cmn/sit）
  /tmp/v139-zip/ShieldEar-…zip     — 完整 v1.3.9 产物（供根因实证）
"""
import hashlib
import json
import os
import sys
import time
import urllib.request
import zipfile

REPO_NUM = 1435969436
API = f"https://api.github.com/repositories/{REPO_NUM}"
TAG = "v1.3.9"
EXPECT_SHA256 = "6ccdc4e2"  # 前缀对账（登记全值见 worklog）
ZIP_OUT = "/tmp/v139-zip"
os.makedirs(ZIP_OUT, exist_ok=True)
zip_path = os.path.join(ZIP_OUT, "ShieldEar-v1.3.9-portable.zip")


def gh_json(url):
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "ShieldEar-asset-recovery",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


# ── 1. 定位 v1.3.9 Release 与资产直链 ──
rel = None
for page in range(1, 6):
    rels = gh_json(f"{API}/releases?per_page=50&page={page}")
    if not rels:
        break
    for x in rels:
        if x.get("tag_name") == TAG:
            rel = x
            break
    if rel:
        break
assert rel, f"未找到 tag {TAG}"
print(f"[1] Release id={rel['id']} tag={TAG}")

asset = next(a for a in rel["assets"] if a["name"].endswith("-portable.zip"))
url = asset["browser_download_url"]
size = asset["size"]
print(f"[2] 资产 {asset['name']} · {size:,} B")
print(f"    {url[:100]}")

# ── 2. 下载（objects.githubusercontent.com 直链，重试 5 次） ──
if os.path.exists(zip_path) and os.path.getsize(zip_path) == size:
    print("[3] 已存在同尺寸本地副本，跳过下载")
else:
    for attempt in range(1, 6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ShieldEar-asset-recovery"})
            with urllib.request.urlopen(req, timeout=300) as r, open(zip_path + ".part", "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            os.replace(zip_path + ".part", zip_path)
            break
        except Exception as e:
            print(f"    下载第 {attempt} 次失败: {e}")
            time.sleep(5)
    assert os.path.exists(zip_path), "下载失败"

got = os.path.getsize(zip_path)
assert got == size, f"尺寸不符 {got} != {size}"
sha = hashlib.sha256(open(zip_path, "rb").read()).hexdigest()
print(f"[3] 下载完成 · SHA-256 {sha[:16]}…（登记前缀 {EXPECT_SHA256} → {'一致' if sha.startswith(EXPECT_SHA256) else '不一致!!'}）")
assert sha.startswith(EXPECT_SHA256), "SHA-256 与登记值不符，中止"

# ── 3. 抽取构建资产 ──
n_files = 0
with zipfile.ZipFile(zip_path) as z:
    for info in z.infolist():
        name = info.filename
        if name == "ShieldEar/node.exe":
            out = "/tmp/node.exe"
        elif name.startswith("ShieldEar/espeak-ng/"):
            rel_path = name[len("ShieldEar/espeak-ng/"):]
            if not rel_path:
                continue
            out = os.path.join("/tmp/msi-out", rel_path)
        else:
            continue
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with z.open(info) as src, open(out, "wb") as dst:
            dst.write(src.read())
        os.chmod(out, 0o755)
        n_files += 1
print(f"[4] 抽取 {n_files} 个构建资产文件 → /tmp/node.exe + /tmp/msi-out/")

n_data = sum(len(fs) for _, _, fs in os.walk("/tmp/msi-out/espeak-ng-data"))
print(f"[5] espeak-ng-data 数据文件 {n_data} 个")
assert os.path.exists("/tmp/msi-out/espeak-ng-data/voices/sit/cmn"), "包内缺中文声库 cmn!"
print("[6] ✓ 中文声库 sit/cmn 在位")
print(f"    zip 完整副本保留于 {zip_path}（供 v1.3.9 产物实证）")
