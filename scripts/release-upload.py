#!/usr/bin/env python3
"""release-upload.py — v1.3.4 Release 创建 + 资产上传（修正 % 转义 bug）
用法: python3 scripts/release-upload.py
前置: main 已推至 4ad4773、tag v1.3.4 已推（由 push-v134.sh 完成）
"""
import json, sys, time, urllib.request, os

TOKEN = os.environ.get("GH_TOKEN") or open("/tmp/.ghtoken").read().strip()
REPO = "43aquarius/ShieldEar"
ZIP = "/home/z/my-project/download/ShieldEar-v1.3.4-portable.zip"
SHA256 = os.popen(f"sha256sum {ZIP}").read().split()[0]

body = f"""## 声盾 ShieldEar v1.3.4 — 判决剧场惊艳升级

### 新特性（面向答辩演示的高光时刻）
- **判决剧场**：环形置信度仪表（刻度环逐格点亮 + 数字滚动）→ 判决印章砸落动画（深伪检出红章 / 真人语音翠章）→ 高危卡片红色呼吸描边
- **时频取证视图**：客户端 FFT（1024 点 / 汉宁窗）→ 对数频率轴 magma 热力瀑布图，可疑片段红色高亮、播放光标联动、点击跳转
- **Hero 声纹律动**：多频正弦叠加有机律动，开屏即“系统活着”
- **威胁热力时间线**：实时鉴听逐窗落格战况带 + 告警横幅滑入
- **真伪 A/B 对比试听**：内置对照样本浏览器内双判决（实测真人 25.4% vs 合成 76.0%）
- 三条链路（鉴听/文件/挑战）全部打通本地回放与时频分析
- 全部动效尊重 prefers-reduced-motion

### 交付
- 纯离线便携包 62.1MB（v1.3.3 为 81.1MB）
- 断网 netns 实测 6/6 全绿（仅 lo 接口，espeak 合成约 0.2s 零联网零等待）
- SHA-256: `{SHA256}`

### 升级方式
解压任意目录 → 双击 START-ShieldEar.bat → 浏览器自动打开"""

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

# ── 1. 检查是否已有 v1.3.4 Release（幂等）──
code, rels = api(f"https://api.github.com/repos/{REPO}/releases")
if isinstance(rels, list):
    exist = [r for r in rels if r.get("tag_name") == "v1.3.4"]
else:
    exist = []

if exist:
    rel = exist[0]
    print(f"[release] 已存在 id={rel['id']}，直接上传资产")
else:
    code, rel = api(f"https://api.github.com/repos/{REPO}/releases", data={
        "tag_name": "v1.3.4",
        "target_commitish": "main",
        "name": "ShieldEar v1.3.4 — 判决剧场惊艳升级（纯离线便携版）",
        "body": body,
        "draft": False,
        "prerelease": False,
    })
    if code not in (200, 201) or not isinstance(rel, dict) or "id" not in rel:
        print(f"[release] ✗ 创建失败 HTTP {code}: {str(rel)[:300]}")
        sys.exit(1)
    print(f"[release] ✓ 创建成功 id={rel['id']} url={rel.get('html_url')}")

RID = rel["id"]

# ── 2. 上传资产（62MB，重试 3 次）──
for attempt in range(1, 4):
    try:
        print(f"[upload] 第 {attempt} 次上传（62.1MB）...")
        t0 = time.time()
        with open(ZIP, "rb") as f:
            data = f.read()
        code, res = api(
            f"https://uploads.github.com/repos/{REPO}/releases/{RID}/assets?name=ShieldEar-v1.3.4-portable.zip",
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
