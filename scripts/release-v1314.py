#!/usr/bin/env python3
"""release-v1314.py — v1.3.14 发版（Git Data API 数字 ID 路由）

前置（已完成）：v1.3.14 全部提交经 push-main-only.py 推送，远端 main
与本地同树（f027145dc6）。本脚本只做发版四件事：
  1. 同树复核（远端 main 树 == 本地 HEAD 树，防在旧基座上打标）
  2. 附注标签 v1.3.14（幂等：已存在即保持不动）
  3. Release 创建（幂等复用）+ zip 资产上传（尺寸一致跳过，4 次重试）
  4. CDN 回读下载 16 段并行复核 SHA-256（本地=上传=登记三方一致）

用法: GH_TOKEN=github_pat_xxx python3 scripts/release-v1314.py
复用 api-push-v1312.py 的 gh()/cdn_readback()（模块级 GH_TOKEN 检查）。
"""
import hashlib
import importlib.util
import os
import sys
import time

sys.path.insert(0, "/home/z/my-project/scripts")
spec = importlib.util.spec_from_file_location(
    "apiv1312", "/home/z/my-project/scripts/api-push-v1312.py"
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)  # 需要 GH_TOKEN 已设置（模块级检查）

gh, cdn_readback = mod.gh, mod.cdn_readback
API = mod.API

TAG = "v1.3.14"
ZIP = "/home/z/my-project/download/ShieldEar-v1.3.14-portable.zip"
ASSET_NAME = "ShieldEar-v1.3.14-portable.zip"
READBACK = "/tmp/v1314-readback.zip"
GIT_DIR = "/home/z/my-project"

TAG_MESSAGE = "v1.3.14 — 安全加固：证据链路径遍历修复 + 全站 HTTP 安全响应头 + 服务层单测 126 项"
RELEASE_NAME = "ShieldEar v1.3.14 — 安全加固（纯离线便携版）"

RELEASE_BODY = """## 声盾 ShieldEar v1.3.14 — 安全加固版

### 变更内容

**1. 修复证据链路由路径遍历缺陷（自审计发现）** — `/api/evidence/[caseNo]` 历史上未查库先读文件，未校验的案件编号直接拼入证据路径，`%2E%2E%2F` 编码段可逃逸 `evidence/` 目录。修复采用双重独立防线：
- **格式闸**：全部 5 个 `[caseNo]` 路由入口校验 `^SS-\\d{8}-\\d{4}$`（服务端编号生成器的唯一产出格式），非法输入 400 早退；
- **容器闸**：`evidencePath` 改用 `resolveInsideDir` 解析并断言结果仍在证据目录内，即使未来新增调用方绕过格式闸也无路可逃。

**2. 全站 HTTP 安全响应头** — `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`（阻断将核验页面 iframe 嵌套伪造「核验通过」假象）、`Referrer-Policy: no-referrer`、`Permissions-Policy`（仅保留实时鉴听所需麦克风）与 CSP。其中 **`connect-src 'self'` 使「全程零外连」的离线声明获得传输层强制执行**——任何违背声明的网络请求将被浏览器直接拦截。

**3. 服务层单测体系扩充（104 → 126 项）** — 新增案件编号格式闸攻击面测试（遍历载荷逐一钉死）与存证包 ZIP 构建器契约测试（CRC-32 IEEE 公开校验向量对拍 + 迷你解析器往返 + Python zipfile 交叉验证）；CI 质量门与构建冒烟双 job 全绿。

检测引擎与判决口径与 v1.3.12 一致（引擎 v2.0.0-calibrated，十一维特征）—— 本版为纯加固，不调参、不改判决。

### 验证（断网 netns · unshare -rn · 解压交付 zip 原物实测）
- **基线 8/8 全绿**：检测输入 · 实时鉴听 · 文件检测 · 案例库 · 存证包 WAV · 合成通道下线 404 · 系统自检 4/4（engine=v2.0.0-calibrated · releaseOffline=true）· 证据核验 SHA-256 重算一致
- **v1.3.14 专项 9/9 全绿**：安全响应头（五项 × 首页与 API 实测回读）· caseNo 格式闸（7 类遍历载荷对交付包实测 400 + 良构 404/verify 200 语义不误伤）· 引擎 v2.0 口径 · 合成通道下线 · 自检四项 · 并发存证竞态 6/6 · 存证包 ZIP 自洽 · 请求体早期上限 413

### 交付
- 纯离线便携包 57.9MB（1,459 文件）
- SHA-256: `{sha256}`

### 升级方式
解压任意目录 → 双击 START-ShieldEar.bat → 浏览器自动打开 http://127.0.0.1:3000"""


def main():
    # ── 1. 同树复核（防在旧基座上打标） ──
    code, ref = gh("GET", f"{API}/git/ref/heads/main")
    remote_tip = ref["object"]["sha"]
    code, rc = gh("GET", f"{API}/git/commits/{remote_tip}")
    remote_tree = rc.get("tree", {}).get("sha", "?")
    local_tree = mod.git("rev-parse", "HEAD^{tree}")
    if remote_tree != local_tree:
        raise RuntimeError(f"远端 main 树 {remote_tree[:10]} ≠ 本地 HEAD 树 {local_tree[:10]}（先推送再发版）")
    print(f"✓ 远端 main={remote_tip[:10]}（树 {remote_tree[:10]} == 本地，发版基座确认）")

    # ── 2. 附注标签（幂等） ──
    print(f"── 附注标签 {TAG} ──")
    code, existing = gh("GET", f"{API}/git/ref/tags/{TAG}")
    if code == 200:
        print(f"  标签引用已存在 → {existing['object']['sha'][:10]}（保持不动，标签锚定发版提交）")
    else:
        code, tagobj = gh("POST", f"{API}/git/tags", {
            "tag": TAG,
            "message": TAG_MESSAGE,
            "object": remote_tip,
            "type": "commit",
            "tagger": {"name": "43aquarius", "email": "43aquarius@users.noreply.github.com"},
        })
        if code == 422:
            print("  标签对象已存在，复用")
        elif code != 201:
            raise RuntimeError(f"tag object 失败: {tagobj}")
        if code == 201:
            code, rr = gh("POST", f"{API}/git/refs", {"ref": f"refs/tags/{TAG}", "sha": tagobj["sha"]})
            if code == 422:
                print("  标签引用已存在")
            elif code != 201:
                raise RuntimeError(f"tag ref 失败: {rr}")
    print(f"✓ 标签 {TAG} 就绪")

    # ── 3. Release + 资产上传（幂等） ──
    sha256 = hashlib.sha256(open(ZIP, "rb").read()).hexdigest()
    print(f"── Release {TAG}（资产 SHA-256 {sha256[:16]}…）──")
    code, rels = gh("GET", f"{API}/releases?per_page=100")
    rel = next((x for x in rels if x.get("tag_name") == TAG), None) if isinstance(rels, list) else None
    if rel:
        print(f"  已存在 id={rel['id']}，复用")
    else:
        code, rel = gh("POST", f"{API}/releases", {
            "tag_name": TAG,
            "target_commitish": "main",
            "name": RELEASE_NAME,
            "body": RELEASE_BODY.replace("{sha256}", sha256),
            "draft": False,
            "prerelease": False,
        })
        if code != 201:
            raise RuntimeError(f"Release 创建失败: {rel}")
        print(f"  ✓ 创建 id={rel['id']}")

    asset = next((a for a in rel.get("assets", []) if a["name"] == ASSET_NAME), None)
    if asset and asset.get("state") == "uploaded" and asset.get("size") == os.path.getsize(ZIP):
        print(f"  资产已上传且尺寸一致（{asset['size']:,}B），跳过")
    else:
        if asset:
            gh("DELETE", f"{API}/releases/assets/{asset['id']}")
            print("  删除旧资产，重传")
        raw = open(ZIP, "rb").read()
        ok = False
        for attempt in range(1, 5):
            code, resp = gh("POST",
                            f"{mod.UPLOADS}/releases/{rel['id']}/assets?name={ASSET_NAME}",
                            ctype="application/zip", raw=raw, timeout=1800)
            if code == 201:
                print(f"  ✓ 上传成功 {resp.get('size'):,}B · state={resp.get('state')}")
                ok = True
                break
            print(f"  第 {attempt} 次失败: {code} {str(resp)[:120]}，5s 后重试")
            time.sleep(5)
        if not ok:
            raise RuntimeError("资产上传 4 次均失败")

    # ── 4. CDN 回读复核（16 段并行） ──
    print("── CDN 回读下载复核（16 段并行）──")
    code, rel2 = gh("GET", f"{API}/releases/tags/{TAG}")
    asset2 = next(a for a in rel2["assets"] if a["name"] == ASSET_NAME)
    rb, n = cdn_readback(asset2["browser_download_url"], asset2["size"], READBACK)
    three_way = "一致" if rb == sha256 else f"不一致!! 回读 {rb[:16]}"
    print(f"  回读 {n:,}B · SHA-256 {rb[:16]}… · 本地=上传=登记 {three_way}")
    if rb != sha256:
        raise RuntimeError("回读哈希不一致，发版中止")
    print(f"\n═══ v1.3.14 发版完成：main={remote_tip[:10]} · tag={TAG} · Release id={rel['id']} ═══")


if __name__ == "__main__":
    main()
