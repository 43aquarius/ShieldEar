#!/usr/bin/env python3
"""release-v138-rest.py — REST 直达发布（绕过 push-v138.sh 的 git 步骤）

背景：2026-11-07 通道实况 —— api.github.com 对本仓库 GET 假 404（跨边缘），
但 POST 写通路完好（空 body 探针 422 验证）；git 通道好/坏窗口交替，
main 已推上（bcc6303），tag v1.3.8 已由 GraphQL createRef 创建（85e2674）。
本脚本只做两件事（= push-v138.sh 的 [3/4][4/4] 步）：
  1. POST 创建 Release（幂等：already_exists 时用 GraphQL 查现有 databaseId）
  2. 上传便携包资产到 uploads.github.com（5 次重试）

用法: GH_TOKEN=github_pat_xxx python3 scripts/release-v138-rest.py
"""
import json
import hashlib
import os
import sys
import time
import urllib.request

# 轮询参数可环境变量化（供 poll-v138-combined.sh 组合调用时缩短）
POLL_ATTEMPTS = int(os.environ.get("POLL_ATTEMPTS", "12"))
POLL_SLEEP = int(os.environ.get("POLL_SLEEP", "55"))

REPO = "43aquaris/ShieldEar"
REPO_ID = "R_kgDOVZcnnA"
REPO_NUM = 1435969436  # GraphQL databaseId；名字索引故障期改用 /repositories/{id} 路由
OWNER, NAME = "43aquarius", "ShieldEar"
TAG = "v1.3.8"
ZIP = "/home/z/my-project/download/ShieldEar-v1.3.8-portable.zip"
ASSET_NAME = "ShieldEar-v1.3.8-portable.zip"

TOKEN = os.environ.get("GH_TOKEN") or sys.exit("需要 GH_TOKEN 环境变量")

RELEASE_NAME = "ShieldEar v1.3.8 — 本地合成引擎根因修正（DLL 文件名 · 双名随包 + 三层自愈 + 打包硬闸）"

RELEASE_BODY_TMPL = """## 声盾 ShieldEar v1.3.8 — 本地合成引擎根因修正（DLL 文件名修复）

### 修复内容
彻底解决「系统自检提示本地合成引擎失败 / 合成挑战报『未找到可用的 espeak-ng』」的问题。

**真正根因**（用户真机实测坐实）：包内 `espeak-ng.exe`（官方 CI 构建）的 PE 导入表要求 `libespeak-ng.dll`（**连字符**），而发行包内的文件名是 `libespeak_ng.dll`（**下划线**）—— 一字之差，导致**任何** Windows 电脑上合成器都以 `0xC0000135`（DLL 找不到）拒绝启动。

**v1.3.7 误诊说明**：v1.3.7 曾将该错误归因于「系统缺少 VC++ 运行库 / 杀毒误删」并随包分发了 VC++ 三 DLL —— 那些运行库确实是必要依赖，但并非本故障根因；装了运行库也照样复现。向被误导的用户致歉。

**修复（四层防线）**：
- 包内同时分发两个文件名的 DLL（`libespeak-ng.dll` + `libespeak_ng.dll`）；
- 三层运行时自愈：启动自检自动补齐别名（boot.js）、合成探测前自动补齐（local-tts.ts）、随包 `windows-smoke.cmd` 可双击就地修复 v1.3.7 旧包；
- 打包流水线新增 **PE 导入表硬闸**：包内任何二进制引用的每个 DLL 必须按名可解析，否则拒绝打包 —— 本类事故从构建期即被拦截；
- `0xC0000135` 报错文案修正为「包内 DLL 缺失或文件名不匹配」，不再误导用户去装 VC++。

### 新增
- `windows-smoke.cmd`（包根目录）：双击 10 秒验证本地合成引擎（版本探测 → 中文合成 → 产物校验），全绿即健康。

### 交付
- 纯离线便携包约 70MB（含双文件名 DLL 与 VC++ 运行库，Win10/11 解压即用，**无需安装任何运行库**）
- 断网 netns 实测（解压后交付 zip · 仅 lo 接口 · 零联网零等待）8/8 全绿
- SHA-256: `%s`

### 升级方式
解压任意目录 → 双击 START-ShieldEar.bat → 浏览器自动打开 http://127.0.0.1:3000

### 旧包就地修复（不想重新下载时）
在 v1.3.7 包根目录执行 `windows-smoke.cmd`（从本 Release 单独下载该文件放入亦可），脚本会自动补齐 `espeak-ng\\libespeak-ng.dll`；或手动复制：`espeak-ng\\libespeak_ng.dll` → `espeak-ng\\libespeak-ng.dll`。"""


def req_json(url: str, data: bytes | None, headers: dict, timeout: int = 60):
    r = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"_exc": str(e)}


def gql(query: str, variables: dict):
    payload = json.dumps({"query": query, "variables": variables}).encode()
    code, d = req_json(
        "https://api.github.com/graphql",
        payload,
        {
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "shieldear-release-script",
        },
    )
    if code != 200:
        return None
    return d


def main() -> int:
    sha = hashlib.sha256(open(ZIP, "rb").read()).hexdigest()
    print(f"[zip] SHA-256 {sha}")

    rel_id = None
    # ── 1. 创建 Release（POST 通路完好；幂等兜底）──
    payload = json.dumps(
        {
            "tag_name": TAG,
            "target_commitish": "main",
            "name": RELEASE_NAME,
            "body": RELEASE_BODY_TMPL % sha,
            "draft": False,
            "prerelease": False,
        }
    ).encode()
    # 长轮询：本仓库名字索引故障（/repos/{owner}/{repo} 全线假 404，git 端点同步抖动），
    # 但 /repositories/{数字ID} 路由完好（GET 200 / 空探针 422 双验证），走 ID 路由创建。
    for attempt in range(1, POLL_ATTEMPTS + 1):
        code, d = req_json(
            f"https://api.github.com/repositories/{REPO_NUM}/releases?cb={attempt}",
            payload,
            {
                "Authorization": f"Bearer {TOKEN}",
                "Content-Type": "application/json",
                "User-Agent": "shieldear-release-script",
            },
        )
        if code == 201 and d.get("id"):
            rel_id = d["id"]
            print(f"[release] ✓ 已创建 id={rel_id} · {d.get('html_url')}")
            break
        if code == 422 and "already_exists" in json.dumps(d):
            print("[release] Release 已存在 → GraphQL 查 databaseId…")
            g = gql(
                'query($o:String!,$n:String!){ repository(owner:$o,name:$n){ release(tagName:"%s"){ databaseId url releaseAssets(first:1){ totalCount } } } }' % TAG,
                {"o": OWNER, "n": NAME},
            )
            rel = (((g or {}).get("data") or {}).get("repository") or {}).get("release") or {}
            if rel.get("databaseId"):
                rel_id = rel["databaseId"]
                n_assets = ((rel.get("releaseAssets") or {}).get("totalCount"))
                print(f"[release] ✓ 复用现有 id={rel_id} · {rel.get('url')} · 既有资产 {n_assets} 个")
                break
            print("[release] ✗ already_exists 但 GraphQL 查不到，重试…")
        else:
            print(f"[release] 第 {attempt} 次未确认（HTTP {code} · {time.strftime('%H:%M:%S')}）: {json.dumps(d, ensure_ascii=False)[:160]}")
        time.sleep(POLL_SLEEP)
    if not rel_id:
        print(f"✗ Release 创建失败（本轮 {POLL_ATTEMPTS} 次长轮询均未成功，稍后重跑本脚本即可续试）")
        return 1

    # ── 2. 上传资产（uploads.github.com · 数字 ID 路由优先，名字路由兜底）──
    up_hdr = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/zip",
        "User-Agent": "shieldear-release-script",
    }
    data = open(ZIP, "rb").read()
    urls = [
        f"https://uploads.github.com/repositories/{REPO_NUM}/releases/{rel_id}/assets?name={ASSET_NAME}",
        f"https://uploads.github.com/repos/{REPO}/releases/{rel_id}/assets?name={ASSET_NAME}",
    ]
    for attempt in range(1, 6):
        url = urls[(attempt - 1) % len(urls)]
        print(f"[upload] 第 {attempt} 次上传（{len(data)/1048576:.1f}MB → {url.split('github.com')[1].split('?')[0]}）…")
        code, d = req_json(url, data, up_hdr, timeout=1800)
        if code == 201 and d.get("browser_download_url"):
            print(f"[upload] ✓ {d['browser_download_url']} · size={d.get('size')}")
            print(f"[upload] asset id={d.get('id')} state={d.get('state')}")
            return 0
        print(f"[upload] 未确认（HTTP {code}）: {json.dumps(d, ensure_ascii=False)[:200]}")
        time.sleep(5)
    print("✗ 资产上传 5 次未确认")
    return 1


if __name__ == "__main__":
    sys.exit(main())
