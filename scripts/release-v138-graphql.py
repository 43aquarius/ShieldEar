#!/usr/bin/env python3
"""release-v138-graphql.py — REST 仓库路由假 404 期间的 GraphQL 备援发布通道

背景（2026-11-07 实况）：api.github.com 对本仓库（43aquaris/ShieldEar）的
全部 REST 仓库级路由（/repos /releases /git/refs …）跨边缘假 404，git 智能
协议好/坏窗口分钟级交替；而 GraphQL（api.github.com/graphql）全程正常。
本脚本用 GraphQL 完成 v1.3.8 发布的 tag + Release 两步（资产上传另行走
uploads.github.com，见 upload-release-asset-graphql.sh）。

步骤：
  1. createRef —— 轻量 tag refs/tags/v1.3.8 → 85e2674（v1.3.8 修复提交）；
     若远端已有同名 tag（git 通道曾推上过）则幂等放行。
  2. createRelease —— 幂等：already_exists 时改查现有 Release。
  3. 输出 Release node id / databaseId / uploadUrl 供资产上传使用。

用法: GH_TOKEN=github_pat_xxx python3 scripts/release-v138-graphql.py
"""
import json
import hashlib
import os
import sys
import urllib.request

API = "https://api.github.com/graphql"
REPO_ID = "R_kgDOVZcnnA"
OWNER, NAME = "43aquarius", "ShieldEar"
TAG = "v1.3.8"
COMMIT = "85e2674930bec32b4403dd93f764fe5d83eedd81"
ZIP = "/home/z/my-project/download/ShieldEar-v1.3.8-portable.zip"

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


def gql(query: str, variables: dict):
    payload = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        API,
        data=payload,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "shieldear-release-script",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def main() -> int:
    sha = hashlib.sha256(open(ZIP, "rb").read()).hexdigest()
    print(f"[zip] {ZIP}")
    print(f"[zip] SHA-256 {sha}")

    # ── 1. 轻量 tag（幂等）──
    r = gql(
        "mutation($in: CreateRefInput!){ createRef(input:$in){ ref { name target { oid } } } }",
        {"in": {"repositoryId": REPO_ID, "name": f"refs/tags/{TAG}", "oid": COMMIT}},
    )
    err = (r.get("errors") or [{}])[0]
    if "already exists" in str(err):
        print(f"[tag] refs/tags/{TAG} 已存在于远端（幂等放行）")
    elif r.get("errors"):
        print(f"[tag] 失败: {json.dumps(r['errors'], ensure_ascii=False)[:300]}")
        return 1
    else:
        ref = r["data"]["createRef"]["ref"]
        print(f"[tag] ✓ 已创建 {ref['name']} → {ref['target']['oid']}")

    # ── 2. Release（幂等）──
    body = RELEASE_BODY_TMPL % sha
    r = gql(
        "mutation($in: CreateReleaseInput!){ createRelease(input:$in){ release { id databaseId url uploadUrl } } }",
        {
            "in": {
                "repositoryId": REPO_ID,
                "tagName": TAG,
                "name": RELEASE_NAME,
                "body": body,
                "isDraft": False,
                "isPrerelease": False,
            }
        },
    )
    if r.get("errors"):
        msg = json.dumps(r["errors"], ensure_ascii=False)
        if "already_exists" in msg or "already exists" in msg:
            print("[release] Release 已存在，改查现有记录…")
            r = gql(
                "query($o:String!,$n:String!){ repository(owner:$o,name:$n){ "
                "release(tagName:\"%s\"){ id databaseId url uploadUrl assets(totalCount:0){ totalCount } } } }" % TAG,
                {"o": OWNER, "n": NAME},
            )
            rel = r["data"]["repository"]["release"]
            if not rel:
                print("[release] ✗ already_exists 但查不到 Release，异常")
                return 1
            print(f"[release] ✓ 复用现有 Release: {rel['url']}")
        else:
            print(f"[release] 失败: {msg[:300]}")
            return 1
    else:
        rel = r["data"]["createRelease"]["release"]
        print(f"[release] ✓ 已创建: {rel['url']}")

    print(f"[release] node id     : {rel['id']}")
    print(f"[release] databaseId : {rel.get('databaseId')}")
    print(f"[release] uploadUrl  : {rel.get('uploadUrl')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
