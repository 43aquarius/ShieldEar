#!/usr/bin/env python3
"""api-push-v1315.py — v1.3.15 七+1 提交推送（Git Data API 数字 ID 路由，可续跑）

用法: GH_TOKEN=$(cat .secrets/github_pat) python3 scripts/api-push-v1315.py

背景：远端 main=c946325（v1.3.14 发版实录推前态，树 b6e77a92），本地同名义
提交 da1fd45 其后被 amend 对齐沙箱 755 权限（树 50a659dc，blob 零差异，仅
24 文件 mode 644→755）。故先在远端复刻一个权限对齐提交（树硬校验 ==
50a659dc），再逐位复刻 v1.3.15 的 8 个本地提交（同树异形：远端父链 SHA 与
本地不同，但每一步树 SHA 必须与本地对应提交完全一致，否则硬中止）。

可续跑：按「远端 tip 树 == 本地某提交树」判断进度，被沙箱收割后重跑自动
从断点续推（对齐提交用固定日期保证幂等确定性）。
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

TOKEN = os.environ.get("GH_TOKEN") or sys.exit("需要 GH_TOKEN 环境变量")
REPO_NUM = 1435969436
API = f"https://api.github.com/repositories/{REPO_NUM}"
GIT_DIR = "/home/z/my-project"

# 本地待推送链（旧 → 新），da1fd45 为对齐目标（其树即对齐树）
ALIGN_LOCAL = "da1fd45"
# 命令行可追加待推提交（如工具入库提交）：python3 api-push-v1315.py <sha>...
CHAIN = [
    "151d433",  # feat(v1.3.15): 引擎 v2.1.0-robust 抗干扰鲁棒性
    "3c0a2a8",  # chore(v1.3.15): regress-v1315 专项回归入库
    "8f97244",  # docs(v1.3.15): 三份参赛文档口径升级
    "d19bb9b",  # perf(v1.3.15): 单窗 P99 时延复测+回归钉
    "983067a",  # feat(v1.3.15): 质量诊断呈现完善
    "61a5ba7",  # fix(v1.3.15): 安全复查 — 依赖清零 5 critical 等
    "844519f",  # chore(v1.3.15): vitest __dirname 弃用告警治理
    "25f02df",  # perf(v1.3.15): P95 端到端判决时延剖析
] + (sys.argv[1:] if len(sys.argv) > 1 else [])
ALIGN_DATE = "2026-11-10T04:45:00+00:00"  # 固定日期 → 重跑幂等
ALIGN_MSG = """chore(v1.3.15): 文件权限基线对齐 — 24 文件 644→755 与本地基线一致（blob 零变化）

远端 main 此前停留在 v1.3.14 发版实录推送时点（c946325，树 b6e77a92），
本地同名提交其后被 amend 按沙箱文件系统实况对齐 24 个文件的权限
（644→755，blob 逐位一致，树 50a659dc）。本提交把远端权限基线同步到
与本地 da1fd45 树完全一致，使 v1.3.15 的 8 个提交可逐位同树复刻。
树 SHA 硬校验：本提交树 == 50a659dc999091d129e64a9c54b344427499f12c。"""


def gh(method, url, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/vnd.github+json",
        "User-Agent": "ShieldEar-release-script",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = r.read()
            return r.status, (json.loads(payload) if payload[:1] in (b"{", b"[") else payload)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def git(*args):
    r = subprocess.run(["git", "-C", GIT_DIR, "-c", "core.quotePath=false", *args],
                       capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:3])}… 失败: {r.stderr.decode()[:200]}")
    return r.stdout.decode().strip()


def tree_of(rev):
    return git("rev-parse", f"{rev}^{{tree}}")


def commit_meta(local_commit):
    raw = git("log", "-1", "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI", local_commit)
    an, ae, ad, cn, ce, cd = raw.split("\x00")
    return ({"name": an, "email": ae, "date": ad},
            {"name": cn, "email": ce, "date": cd},
            git("log", "-1", "--format=%B", local_commit))


def replicate(local_commit, remote_parent):
    """把本地提交复刻到远端 remote_parent 之上，树必须与本地逐位一致（硬校验）。"""
    code, pc = gh("GET", f"{API}/git/commits/{remote_parent}")
    if code != 200:
        raise RuntimeError(f"远端缺父提交 {remote_parent}: {pc}")
    base_tree = pc["tree"]["sha"]

    entries = []
    for line in git("diff", "--name-status", f"{local_commit}^", local_commit).splitlines():
        parts = line.split("\t")
        status = parts[0]
        if status[:1] in ("R", "C"):
            old, path = parts[1], parts[2]
            entries.append({"path": old, "type": "blob", "sha": None})
            print(f"    D {old}（{status[:1]} 源）")
        else:
            path = parts[1]
        if status[:1] == "D":
            entries.append({"path": path, "type": "blob", "sha": None})
            print(f"    D {path}")
            continue
        meta, _ = git("ls-tree", local_commit, "--", path).split("\t", 1)
        mode, _, blob_sha = meta.split()
        content = subprocess.run(["git", "-C", GIT_DIR, "cat-file", "blob", blob_sha],
                                 capture_output=True, check=True).stdout
        code, blob = gh("POST", f"{API}/git/blobs",
                        {"content": base64.b64encode(content).decode(), "encoding": "base64"})
        if code != 201:
            raise RuntimeError(f"blob 失败 {path}: {blob}")
        if blob["sha"] != blob_sha:
            raise RuntimeError(f"blob SHA 不一致 {path}")
        entries.append({"path": path, "mode": mode, "type": "blob", "sha": blob_sha})
        print(f"    {status} {path} ({len(content):,}B ✓{blob_sha[:8]})")

    code, tree = gh("POST", f"{API}/git/trees", {"base_tree": base_tree, "tree": entries})
    if code != 201:
        raise RuntimeError(f"tree 失败: {tree}")
    local_tree = tree_of(local_commit)
    if tree["sha"] != local_tree:
        raise RuntimeError(f"树硬校验失败 {local_commit[:10]}: 远端建树 {tree['sha']} ≠ 本地 {local_tree}")
    print(f"    tree {tree['sha'][:10]} ✓与本地逐位一致")

    author, committer, msg = commit_meta(local_commit)
    code, commit = gh("POST", f"{API}/git/commits", {
        "message": msg, "tree": tree["sha"], "parents": [remote_parent],
        "author": author, "committer": committer})
    if code != 201:
        raise RuntimeError(f"commit 失败: {commit}")
    print(f"  ✓ 提交 {local_commit[:10]} → 远端 {commit['sha'][:10]}（同树异形）")
    return commit["sha"]


def make_alignment(remote_tip):
    """远端建权限对齐提交：树硬校验 == 本地 da1fd45 树。幂等（固定日期确定性重跑）。"""
    code, pc = gh("GET", f"{API}/git/commits/{remote_tip}")
    base_tree = pc["tree"]["sha"]
    target_tree = tree_of(ALIGN_LOCAL)

    # 本地 da1fd45 全量 blob → 与远端树比对得 mode 差异路径
    try:
        d = json.load(open("/tmp/remote_tree.json"))
    except Exception:
        d = {}
    if d.get("sha") != base_tree:
        code, d = gh("GET", f"{API}/git/trees/{base_tree}?recursive=1")
        if d.get("truncated"):
            raise RuntimeError("远端树被截断，需分目录取")
        json.dump(d, open("/tmp/remote_tree.json", "w"))
    remote = {e["path"]: (e["mode"], e["sha"]) for e in d["tree"] if e["type"] == "blob"}
    entries = []
    for line in git("ls-tree", "-r", ALIGN_LOCAL).splitlines():
        meta, path = line.split("\t", 1)
        mode, _, sha = meta.split()
        rm = remote.get(path)
        if rm is None:
            raise RuntimeError(f"远端缺 {path}，非纯权限分叉，中止")
        if rm[1] != sha:
            raise RuntimeError(f"blob 不同 {path}，非纯权限分叉，中止")
        if rm[0] != mode:
            entries.append({"path": path, "mode": mode, "type": "blob", "sha": sha})
    print(f"── 权限对齐：{len(entries)} 文件 mode → 本地基线 ──")
    if not entries:
        print("  无差异（异常：树 SHA 却不同），中止排查")
        sys.exit(1)

    code, tree = gh("POST", f"{API}/git/trees", {"base_tree": base_tree, "tree": entries})
    if code != 201:
        raise RuntimeError(f"对齐 tree 失败: {tree}")
    if tree["sha"] != target_tree:
        raise RuntimeError(f"对齐树硬校验失败: 远端建树 {tree['sha']} ≠ 本地目标 {target_tree}")
    print(f"    tree {tree['sha'][:10]} ✓== 本地 da1fd45 树（逐位一致）")

    iden = {"name": "43aquarius", "email": "43aquarius@users.noreply.github.com"}
    code, commit = gh("POST", f"{API}/git/commits", {
        "message": ALIGN_MSG, "tree": tree["sha"], "parents": [remote_tip],
        "author": {**iden, "date": ALIGN_DATE}, "committer": {**iden, "date": ALIGN_DATE}})
    if code != 201:
        raise RuntimeError(f"对齐 commit 失败: {commit}")
    print(f"  ✓ 对齐提交远端 {commit['sha'][:10]}（仅远端存在，本地无需）")
    return commit["sha"]


def main():
    code, ref = gh("GET", f"{API}/git/ref/heads/main")
    tip = ref["object"]["sha"]
    code, tc = gh("GET", f"{API}/git/commits/{tip}")
    tip_tree = tc["tree"]["sha"]
    final_tree = tree_of(CHAIN[-1])
    print(f"远端 main={tip[:10]} 树 {tip_tree[:10]}；本地终点目标树 {final_tree[:10]}")

    if tip_tree == final_tree:
        print("✓ 远端已是目标树（此前已推完），仅复核")
    else:
        # 断点定位：远端 tip 树 == 本地链中某提交树 → 从下一个续推
        start = 0
        if tip_tree == tree_of(ALIGN_LOCAL):
            print("断点：对齐已完成，直接复刻 8 提交")
        else:
            hit = None
            for i, c in enumerate(CHAIN):
                if tip_tree == tree_of(c):
                    hit = i
                    break
            if hit is not None:
                start = hit + 1
                print(f"断点：远端已含至 {CHAIN[hit][:10]}，从 {CHAIN[start][:10]} 续推")
            else:
                # 非快进基座 → 需先对齐（本例：c946325 推前态）
                print("远端基座为推前态 → 先建权限对齐提交")
                tip = make_alignment(tip)
        for idx, c in enumerate(CHAIN[start:]):
            print(f"── 复刻 {c[:10]}：{git('log', '-1', '--format=%s', c)[:56]}")
            tip = replicate(c, tip)
            # 每 3 提交即更新 ref，收割后断点更近
            if (idx + 1) % 3 == 0 or c == CHAIN[-1]:
                code, _ = gh("PATCH", f"{API}/git/refs/heads/main", {"sha": tip, "force": False})
                print(f"  ⤴ main 中间快进 → {tip[:10]}（{code}）")
        code, _ = gh("PATCH", f"{API}/git/refs/heads/main", {"sha": tip, "force": False})
        if code not in (200, 201):
            raise RuntimeError(f"ref 更新失败: {code}")

    # 终局复核
    code, ref2 = gh("GET", f"{API}/git/ref/heads/main")
    code, fc = gh("GET", f"{API}/git/commits/{ref2['object']['sha']}")
    ok = fc["tree"]["sha"] == final_tree
    print(f"\n终局：remote main={ref2['object']['sha'][:10]} 树 {fc['tree']['sha'][:10]} "
          f"{'✓== 本地 25f02df 树' if ok else '✗ 不一致!!'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
