#!/usr/bin/env python3
"""api-push-v1310.py — v1.3.10 发版（Git Data API 数字 ID 路由，全流程）

用法: GH_TOKEN=github_pat_xxx python3 scripts/api-push-v1310.py

流程（名字路由对本仓库仍假 404，全程走 /repositories/1435969436）：
  1. 逐提交复刻（blob 内容寻址逐个校验 + 树 SHA 一致性 + 同树异形快进）
  2. PATCH main（快进）
  3. 附注标签 v1.3.10
  4. Release（幂等，存在即复用）
  5. 资产上传（4 次重试）
  6. CDN 回读下载并复核 SHA-256（本地=上传=登记三方一致）
"""
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

TOKEN = os.environ.get("GH_TOKEN") or sys.exit("需要 GH_TOKEN 环境变量")
REPO_NUM = 1435969436
API = f"https://api.github.com/repositories/{REPO_NUM}"
UPLOADS = f"https://uploads.github.com/repositories/{REPO_NUM}"
TAG = "v1.3.10"
ZIP = "/home/z/my-project/download/ShieldEar-v1.3.10-portable.zip"
ASSET_NAME = "ShieldEar-v1.3.10-portable.zip"
GIT_DIR = "/home/z/my-project"

COMMITS = sys.argv[1:] or [
    "728e5cd",  # fix(api-push): 快进校验改为按树比对
    "c2643ea",  # probe(espeak): v1.3.10 音色变体调校脚本
    "ccd255f",  # v1.3.10: 音色丢弃与中文乱读双症同修
]

RELEASE_BODY = """## 声盾 ShieldEar v1.3.10 — 合成挑战音色与中文朗读热修复

### 修复内容（真机复验 v1.3.9 后的两处缺陷，双症同源）

**1. 七个音色合成出同一个声音** — `synthesizeEspeak` 收了音色参数却从未使用，合成命令硬编码单一中文声部（`-v cmn`）。现按音色映射到「声部变体 + 音高 + 基准语速」三维参数（cmn+f2/f5/f4/m1/m3/m5/m6），实测七音色两两互异：女声组基频 176–250Hz、男声组 80–110Hz；引擎标签如实标注变体（如「espeak-ng 本地合成 · cmn+f2」）。

**2. 合成语音完全不是正常能听的语音** — 文本此前经命令行参数传给合成器，在中文 Windows 上必须经过 ANSI 代码页（GBK）往返转换，而 espeak-ng 按 UTF-8 解读参数，中文必成乱码。PE 导入表实证（`_initialize_narrow_environment` / `__p___argv`，无 `GetCommandLineW`）。现改为文本经标准输入以 UTF-8 字节流直传（`-b 1`），绕开一切代码页转换，跨平台行为一致。

### 验证
- 断网 netns 全套：基线 8/8 + v1.3.10 专项 6/6 全绿（七音色互异 / live 模式 / 并发存证 / 存证包 ZIP / 体积闸）
- 七音色分数带 0.538–0.788（MEDIUM–CRITICAL），真人样本 LOW 0.16–0.25
- 出厂案例库 5 条重灌（含 1 条本地引擎现场合成 live 案例）

### 交付
- 纯离线便携包 74.4MB（1,942 文件）
- SHA-256: `{sha256}`

### 升级方式
解压任意目录 → 双击 START-ShieldEar.bat → 浏览器自动打开 http://127.0.0.1:3000"""


def gh(method, url, body=None, ctype="application/json", raw=None, timeout=60):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": ctype,
        "Accept": "application/vnd.github+json",
        "User-Agent": "ShieldEar-release-script",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = r.read()
            return r.status, (json.loads(payload) if ctype.startswith("application/json") or payload[:1] in (b"{", b"[") else payload)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def git(*args, binary=False):
    r = subprocess.run(["git", "-C", GIT_DIR, *args], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:3])}… 失败: {r.stderr.decode()[:200]}")
    return r.stdout if binary else r.stdout.decode().strip()


def push_commit(local_parent, local_commit, remote_parent):
    """把 local_parent→local_commit 的变更以 API 复刻到远端（挂在远端 remote_parent 之上），返回远端新提交 sha"""
    code, pc = gh("GET", f"{API}/git/commits/{remote_parent}")
    if code != 200:
        raise RuntimeError(f"远端缺父提交 {remote_parent[:8]}: {pc}")
    base_tree = pc["tree"]["sha"]

    files = git("-c", "core.quotePath=false", "diff", "--name-status", local_parent, local_commit).splitlines()
    entries = []
    for line in files:
        status, path = line.split("\t", 1)
        path = path.strip('"')
        if status == "D":
            entries.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
            print(f"    D {path}")
            continue
        ls = git("ls-tree", local_commit, "--", path)
        meta, _ = ls.split("\t", 1)
        mode, typ, blob_sha = meta.split()
        content = git("cat-file", "blob", blob_sha, binary=True)
        b64 = base64.b64encode(content).decode()
        code, blob = gh("POST", f"{API}/git/blobs", {"content": b64, "encoding": "base64"})
        if code != 201:
            raise RuntimeError(f"blob 失败 {path}: {blob}")
        if blob["sha"] != blob_sha:
            raise RuntimeError(f"blob SHA 不一致 {path}: 远端 {blob['sha']} ≠ 本地 {blob_sha}")
        entries.append({"path": path, "mode": mode, "type": "blob", "sha": blob_sha})
        print(f"    {status} {path} ({len(content):,}B ✓{blob_sha[:8]})")

    code, tree = gh("POST", f"{API}/git/trees", {"base_tree": base_tree, "tree": entries})
    if code != 201:
        raise RuntimeError(f"tree 失败: {tree}")
    local_tree = git("rev-parse", f"{local_commit}^{{tree}}")
    match = "✓与本地一致" if tree["sha"] == local_tree else f"≠本地 {local_tree[:8]}（检查内容）"
    print(f"    tree {tree['sha'][:10]} {match}")

    meta_raw = git("log", "-1", "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI", local_commit)
    an, ae, ad, cn, ce, cd = meta_raw.split("\x00")
    msg = git("log", "-1", "--format=%B", local_commit)
    code, commit = gh("POST", f"{API}/git/commits", {
        "message": msg,
        "tree": tree["sha"],
        "parents": [remote_parent],
        "author": {"name": an, "email": ae, "date": ad},
        "committer": {"name": cn, "email": ce, "date": cd},
    })
    if code != 201:
        raise RuntimeError(f"commit 失败: {commit}")
    same = "✓与本地 SHA 完全一致" if commit["sha"] == local_commit else f"（远端 {commit['sha'][:10]}）"
    print(f"  ✓ 提交 {local_commit[:10]} {same}")
    return commit["sha"]


def cdn_readback(url, total, out, n_seg=16):
    """CDN 资产回读：解析 302 拿签名直链 → 分段并行 + 断点续传 → 合并哈希。

    首发实录：单流直读被 CDN 静默掐断（RemoteDisconnected，1800s 超时形同虚设），
    改与 parallel_fetch.py 同款策略；逐段 6 次重试，失败段可整段重跑续传。
    返回 (sha256hex, nbytes)。"""
    req = urllib.request.Request(url, headers={"User-Agent": "ShieldEar-release-script"})
    with urllib.request.urlopen(req, timeout=60) as r:
        url = r.url  # 跟随 302 拿 CDN 签名直链（仅一次，后续分段不再触碰 github.com）
    seg = (total + n_seg - 1) // n_seg
    tmpdir = out + ".parts"
    os.makedirs(tmpdir, exist_ok=True)
    ok = [False] * n_seg

    def fetch(i):
        start, end = i * seg, min((i + 1) * seg - 1, total - 1)
        if start > end:
            ok[i] = True
            return
        part = f"{tmpdir}/p{i:02d}"
        have = os.path.getsize(part) if os.path.exists(part) else 0
        need = end - start + 1
        for _ in range(6):
            if have >= need:
                ok[i] = True
                return
            try:
                rq = urllib.request.Request(url, headers={
                    "Range": f"bytes={start + have}-{end}",
                    "User-Agent": "ShieldEar-release-script"})
                with urllib.request.urlopen(rq, timeout=120) as r, open(part, "ab") as f:
                    first = r.read(1)
                    if first == b"{":  # 防污染：意外拿到 JSON 元数据即弃段重试
                        time.sleep(2)
                        continue
                    f.write(first)
                    have += 1
                    while True:
                        chunk = r.read(65536)
                        if not chunk:
                            break
                        f.write(chunk)
                        have += len(chunk)
            except Exception:
                time.sleep(1.5)
        ok[i] = os.path.getsize(part) >= need if os.path.exists(part) else False

    ts = [threading.Thread(target=fetch, args=(i,)) for i in range(n_seg)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    if not all(ok):
        raise RuntimeError("回读分段下载存在失败段（重跑同命令可续传）")
    got = hashlib.sha256()
    n = 0
    with open(out, "wb") as f:
        for i in range(n_seg):
            with open(f"{tmpdir}/p{i:02d}", "rb") as p:
                data = p.read()
            f.write(data)
            got.update(data)
            n += len(data)
    shutil.rmtree(tmpdir, ignore_errors=True)
    return got.hexdigest(), n


def main():
    # ── 1. 提交复刻（快进基座按树比对） ──
    code, ref = gh("GET", f"{API}/git/ref/heads/main")
    remote_tip = ref["object"]["sha"]
    parent0 = git("rev-parse", f"{COMMITS[0]}^")
    code, rc = gh("GET", f"{API}/git/commits/{remote_tip}")
    remote_tree = rc.get("tree", {}).get("sha", "?")
    local_tree = git("rev-parse", f"{parent0}^{{tree}}")
    if remote_tree != local_tree:
        raise RuntimeError(f"远端 main 树 {remote_tree[:10]} ≠ 本地父树 {local_tree[:10]}（非快进，中止）")
    print(f"✓ 远端 main={remote_tip[:10]}（树 {remote_tree[:10]} 与本地一致），快进基座确认")

    tip = remote_tip
    for c in COMMITS:
        print(f"── 复刻提交 {c[:10]}：{git('log', '-1', '--format=%s', c)[:60]}")
        tip = push_commit(git("rev-parse", f"{c}^"), c, tip)

    print("── 更新 refs/heads/main ──")
    code, r = gh("PATCH", f"{API}/git/refs/heads/main", {"sha": tip, "force": False})
    if code not in (200, 201):
        raise RuntimeError(f"ref 更新失败: {r}")
    print(f"✓ main → {tip[:10]}")

    # ── 2. 附注标签（幂等：引用已存在即保持不动，不随 main 前移、不产孤儿对象）──
    print(f"── 附注标签 {TAG} ──")
    code, existing = gh("GET", f"{API}/git/ref/tags/{TAG}")
    if code == 200:
        print(f"  标签引用已存在 → {existing['object']['sha'][:10]}（保持不动，标签锚定发版提交）")
    else:
        code, tagobj = gh("POST", f"{API}/git/tags", {
            "tag": TAG,
            "message": f"{TAG} — 合成挑战音色丢弃与 Windows 中文乱读双症同修",
            "object": tip,
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

    # ── 3. Release（幂等） ──
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
            "name": "ShieldEar v1.3.10 — 合成音色与中文朗读修复（纯离线便携版）",
            "body": RELEASE_BODY.format(sha256=sha256),
            "draft": False,
            "prerelease": False,
        })
        if code != 201:
            raise RuntimeError(f"Release 创建失败: {rel}")
        print(f"  ✓ 创建 id={rel['id']}")

    # ── 4. 资产上传（重试 4 次） ──
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
                            f"{UPLOADS}/releases/{rel['id']}/assets?name={ASSET_NAME}",
                            ctype="application/zip", raw=raw, timeout=1800)
            if code == 201:
                print(f"  ✓ 上传成功 {resp.get('size'):,}B · state={resp.get('state')}")
                ok = True
                break
            print(f"  第 {attempt} 次失败: {code} {str(resp)[:120]}，5s 后重试")
            time.sleep(5)
        if not ok:
            raise RuntimeError("资产上传 4 次均失败")

    # ── 5. CDN 回读复核（16 段并行 + 逐段续传 · 首发实战加固）──
    print("── CDN 回读下载复核（16 段并行）──")
    code, rel2 = gh("GET", f"{API}/releases/tags/{TAG}")
    asset2 = next(a for a in rel2["assets"] if a["name"] == ASSET_NAME)
    rb, n = cdn_readback(asset2["browser_download_url"], asset2["size"], "/tmp/v1310-readback.zip")
    three_way = "一致" if rb == sha256 else f"不一致!! 回读 {rb[:16]}"
    print(f"  回读 {n:,}B · SHA-256 {rb[:16]}… · 本地=上传=登记 {three_way}")
    if rb != sha256:
        raise RuntimeError("回读哈希不一致，发版中止")
    print(f"\n═══ v1.3.10 发版完成：main={tip[:10]} · tag={TAG} · Release id={rel['id']} ═══")


if __name__ == "__main__":
    main()
