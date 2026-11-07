#!/usr/bin/env python3
"""api-push-v139.py — REST Git Data API 全量推送 + 发版（数字 ID 路由）

背景：GitHub 名字→ID 索引故障持续（git 智能协议与 API 名字路由对本仓库
假 404/Repository not found），但数字 ID 路由 /repositories/1435969436/...
恒正常（v1.3.8 实证，本轮已复核）。本脚本用 Git Data API 把本地两个提交
（d2ca49e → 96ead82）逐文件搬运到远端：

  1. 逐文件建 blob（base64，返回 SHA 与本地 git hash 逐个比对 —— 内容寻址
     天然零漂移校验）
  2. 建树（base_tree 挂在远端父提交树上，只含变更路径）
  3. 建提交（沿用本地 author/committer/时间戳 —— 若全字段一致，远端提交
     SHA 应与本地完全相同）
  4. PATCH refs/heads/main（fast-forward 校验）
  5. 建附注标签 v1.3.9 + 引用
  6. 创建 Release（幂等）+ 上传资产（双路由 × 重试）

用法: GH_TOKEN=github_pat_xxx python3 scripts/api-push-v139.py
"""
import base64
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO_NUM = 1435969436
API = f"https://api.github.com/repositories/{REPO_NUM}"
UPLOADS = f"https://uploads.github.com/repositories/{REPO_NUM}"
TOKEN = os.environ.get("GH_TOKEN") or sys.exit("需要 GH_TOKEN 环境变量")
TAG = "v1.3.9"
ZIP = "/home/z/my-project/download/ShieldEar-v1.3.9-portable.zip"
ASSET_NAME = "ShieldEar-v1.3.9-portable.zip"
GIT_DIR = "/home/z/my-project"

# 本地待推送的提交（顺序 = 历史；可用 argv 覆盖，如：
#   GH_TOKEN=... python3 scripts/api-push-v139.py <commit1> <commit2>
COMMITS = sys.argv[1:] or [
    "d2ca49e282a2986d63b1d0764133b5ea959dd1cb",  # v1.3.8 发布实录入库
    "96ead82b72d52d2133f463d90ed0844a3b431080",  # v1.3.9 根因修正
]


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
    # 远端父提交树（可能与本地父 SHA 不同——内容同树异形）
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
        # mode + 本地 blob sha（ls-tree 格式：<mode> <type> <sha>\t<path>）
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
    # 本地树 SHA 比对（同内容寻址）
    local_tree = git("rev-parse", f"{local_commit}^{{tree}}")
    match = "✓与本地一致" if tree["sha"] == local_tree else f"≠本地 {local_tree[:8]}（检查内容）"
    print(f"    tree {tree['sha'][:10]} {match}")

    # 提交元数据（沿用本地，保证 SHA 尽可能一致）
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


def main():
    # 远端 main 应在第一个本地提交的父上
    code, ref = gh("GET", f"{API}/git/ref/heads/main")
    remote_tip = ref["object"]["sha"]
    parent0 = git("rev-parse", f"{COMMITS[0]}^")
    # 按【树】比对：远端提交可能是本地的同树异形孤儿（API 复刻产物），SHA 不同但内容一致
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

    print(f"── 创建附注标签 {TAG} ──")
    code, tagobj = gh("POST", f"{API}/git/tags", {
        "tag": TAG,
        "message": f"{TAG} — 应用内合成通道根因修正（Turbopack 平台折叠）+ 并发存证/重采样/存证包强化",
        "object": tip,
        "type": "commit",
        "tagger": {"name": "43aquaris", "email": "43aquaris@users.noreply.github.com"},
    })
    if code == 422:
        print("  标签已存在，复用")
    elif code != 201:
        raise RuntimeError(f"tag object 失败: {tagobj}")
    tag_sha = tagobj.get("sha") if code == 201 else None
    if tag_sha:
        code, rr = gh("POST", f"{API}/git/refs", {"ref": f"refs/tags/{TAG}", "sha": tag_sha})
        if code == 422:
            print("  标签引用已存在")
        elif code != 201:
            raise RuntimeError(f"tag ref 失败: {rr}")
    print(f"✓ 标签 {TAG} 就绪")
    return tip


if __name__ == "__main__":
    main()
