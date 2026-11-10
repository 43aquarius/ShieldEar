#!/usr/bin/env python3
"""release-v1315.py — v1.3.15 发版（Git Data API 数字 ID 路由）

前置（已完成）：v1.3.15 全部提交（含发版管线升版）经 api-push-v1315.py 推送，
远端 main 与本地同树。本脚本只做发版三件事：
  1. 同树复核（远端 main 树 == 本地 HEAD 树，防在旧基座上打标）
  2. 附注标签 v1.3.15（幂等：已存在即保持不动）
  3. Release 创建（幂等复用）+ zip 资产上传（尺寸一致跳过，4 次重试）

CDN 回读独立成 readback-asset-v1315.py（v1.3.12 教训：上传+回读合跑超 300s 收割窗）。
用法: GH_TOKEN=$(cat .secrets/github_pat) python3 scripts/release-v1315.py
复用 api-push-v1312.py 的 gh()（模块级 GH_TOKEN 检查）。
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

gh = mod.gh
API = mod.API

TAG = "v1.3.15"
ZIP = "/home/z/my-project/download/ShieldEar-v1.3.15-portable.zip"
ASSET_NAME = "ShieldEar-v1.3.15-portable.zip"
GIT_DIR = "/home/z/my-project"

TAG_MESSAGE = "v1.3.15 — 引擎 v2.1.0-robust：直流免疫 + 输入质量护栏 + 依赖安全清零"
RELEASE_NAME = "ShieldEar v1.3.15 — 引擎 v2.1.0 抗干扰鲁棒性（纯离线便携版）"

RELEASE_BODY = """## 声盾 ShieldEar v1.3.15 — 引擎 v2.1.0-robust 抗干扰鲁棒性

### 变更内容

**1. 引擎 v2.1.0-robust：直流偏置免疫** — 修复直流偏置引发误报的缺陷：+0.05 直流曾使自然人声误报翻倍，帧级/窗口级去均值后，扰动输入与干净输入判决完全一致（实测 ratio 漂移 0.00001，阈值 <0.02）；恒定直流静音不再击穿静音闸（voicedWindows=0 判 LOW 并精确警示 dc-offset）。11 种录音链路扰动 × 15 源全量探针实证留档（`scripts/probe-robustness.ts`）。

**2. 输入质量护栏（四项诊断）** — 削波平顶比 / 直流偏置 / 底噪 / 电平四项诊断随分析输出（`analysis.quality`），不改变判决但明确结论可靠边界；界面与核验报告同步呈现（报告/面板共用格式化）。触发矩阵实证：硬削波 ±0.15 → clipping；×0.05 低电平 → 精确 low-level（平顶比统计自动关闭）；白噪底 RMS 0.03 → noisy-floor。

**3. 安全复查：依赖漏洞清零** — next 16.1.3→16.4.6（修复 4 项 RCE）、next-auth→4.24.15（邮件 homoglyph 绕过）、next-intl / zod / uuid / sharp 同步升级 + 14 项 overrides，bun audit 106 项 → 1（唯余 prisma CLI 链 dev-only deepmerge-ts，修复需 major 8.0，记录接受）；CSP 补 COOP/CORP same-origin 防御纵深；eslint react-hooks v7 新规则治理（useSyncExternalStore 重构 use-mobile 等 4 处）。

**4. 质量与工程** — vitest 139→145 项全绿（弃用告警清零）；单窗 P99 时延复测引擎 v2.1 无劣化；端到端判决时延剖析留档（总体 P95 339ms，引擎占 85.2%，RTF 0.0065，60s 音频外推约 0.9s）。

判决口径：258 判决基线 TP/FP/TN/FN 逐位不变——鲁棒性强化不以改变判决为代价。

### 验证（断网 netns · unshare -rn · 解压交付 zip 原物实测）
- **基线 8/8 全绿**：检测输入 · 实时鉴听 · 文件检测 · 案例库 · 存证包 WAV · 合成通道下线 404 · 系统自检 4/4（engine=v2.1.0-robust · releaseOffline=true）· 证据核验 SHA-256 重算一致
- **v1.3.15 专项 11/11 全绿**：引擎 v2.1 版本口径与自检 · 质量护栏在场（真实校准音频四项全清）· 直流免疫（判决不变 + 静音闸不击穿）· 触发矩阵（削波/低电平/噪底精确警示）· 安全响应头五项 · caseNo 格式闸（遍历载荷 400）· 11 维特征剖面 · 并发存证 6/6 · 存证包 ZIP 自洽 · 请求体早期上限 413

### 交付
- 纯离线便携包 58.1MB（1,361 文件）
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

    print(f"\n═══ v1.3.15 发版（上传）完成：main={remote_tip[:10]} · tag={TAG} · Release id={rel['id']} ═══")
    print("═══ 下一步：readback-asset-v1315.py 16 段并行 CDN 三方一致回读 ═══")


if __name__ == "__main__":
    main()
