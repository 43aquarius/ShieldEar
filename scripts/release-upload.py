#!/usr/bin/env python3
"""release-upload.py — v1.3.6 Release 创建 + 资产上传（幂等可重试）
用法: GH_TOKEN=github_pat_xxx python3 scripts/release-upload.py
前置: main 与 tag v1.3.6 已推（push 命令同 push-v134.sh 模式）
"""
import json, sys, time, urllib.request, os

TOKEN = os.environ.get("GH_TOKEN") or open("/tmp/.ghtoken").read().strip()
REPO = "43aquarius/ShieldEar"
ZIP = "/home/z/my-project/download/ShieldEar-v1.3.6-portable.zip"
SHA256 = os.popen(f"sha256sum {ZIP}").read().split()[0]

body = f"""## 声盾 ShieldEar v1.3.6 — Windows 启动热修复

### 修复内容
修复 v1.3.5 便携包在 Windows 上启动后「案例库加载失败 / 合成挑战失败 / Internal Server Error」的问题。

**根因**：Next.js 16 Turbopack 将 `@prisma/client` 外部化为带内容哈希的模块名（`@prisma/client-2c3a283f134fdcb6`），该模块在包内以目录软链接形式存在；zip 打包时软链被静默丢弃，Windows 解压后模块解析失败，所有走数据库的接口 500。

**修复**：软链解引用为实体文件随包携带；新增交付完整性三重防线（组装期解引用 → 打包前软链零容忍 → chunk 外部依赖逐一解析校验）；断网回归改为「解压后的 zip」实测。

### 交付
- 纯离线便携包 69.8MB（1917 文件）
- 断网 netns 实测 8/8 全绿（解压后交付物 · 仅 lo 接口 · 零联网零等待）
- 真伪 A/B 实测：真人 20.2% vs 合成 72.5%
- SHA-256: `{SHA256}`

### 升级方式
解压任意目录 → 双击 START-ShieldEar.bat → 浏览器自动打开 http://127.0.0.1:3000
（若已下载 v1.3.5，请删除旧包后改用本版；v1.3.5 在 Windows 上无法正常使用）"""

def api(url, data=None, method=None, headers=None, timeout=60):
    h = {"Authorization": f"Bearer {TOKEN}", "User-Agent": "shield-release",
         "Accept": "application/vnd.github+json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=json.dumps(data).encode() if isinstance(data, dict) else data,
                                 headers=h, method=method or ("POST" if data else "GET"))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        try:
            return r.status, json.loads(raw)
        except Exception:
            return r.status, raw

# ── 1. 检查是否已有 v1.3.6 Release（幂等） ──
code, rels = api(f"https://api.github.com/repos/{REPO}/releases")
if isinstance(rels, list):
    exist = [r for r in rels if r.get("tag_name") == "v1.3.6"]
else:
    exist = []

if exist:
    rel = exist[0]
    print(f"[release] 已存在 id={rel['id']}，直接上传资产")
else:
    code, rel = api(f"https://api.github.com/repos/{REPO}/releases", data={
        "tag_name": "v1.3.6",
        "target_commitish": "main",
        "name": "ShieldEar v1.3.6 — Windows 启动热修复（纯离线便携版）",
        "body": body,
        "draft": False,
        "prerelease": False,
    })
    if code not in (200, 201) or not isinstance(rel, dict) or "id" not in rel:
        print(f"[release] ✗ 创建失败 HTTP {code}: {str(rel)[:300]}")
        sys.exit(1)
    print(f"[release] ✓ 创建成功 id={rel['id']} url={rel.get('html_url')}")

RID = rel["id"]

# ── 2. 上传资产（69.8MB，重试 3 次） ──
for attempt in range(1, 4):
    try:
        print(f"[upload] 第 {attempt} 次上传（69.8MB）...")
        t0 = time.time()
        with open(ZIP, "rb") as f:
            data = f.read()
        code, res = api(
            f"https://uploads.github.com/repos/{REPO}/releases/{RID}/assets?name=ShieldEar-v1.3.6-portable.zip",
            data=data, method="POST",
            headers={"Content-Type": "application/zip"}, timeout=1800)
        dt = time.time() - t0
        if isinstance(res, dict) and res.get("browser_download_url"):
            print(f"[upload] ✓ 成功（{dt:.0f}s）: {res['browser_download_url']}")
            print(f"[upload] 大小校验: {res.get('size')} bytes")
            sys.exit(0)
        print(f"[upload] ✗ HTTP {code}: {str(res)[:200]}")
    except Exception as e:
        print(f"[upload] ✗ 异常: {e}")
    time.sleep(5)
sys.exit(1)
