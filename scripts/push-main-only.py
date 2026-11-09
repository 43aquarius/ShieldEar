#!/usr/bin/env python3
"""push-main-only.py — 复刻指定本地提交到远端并快进 main（无标签/Release/资产）

用法: GH_TOKEN=github_pat_xxx python3 scripts/push-main-only.py <提交SHA>...
复用 api-push-v1312.py 的 gh()/git()/push_commit()（名字路由假 404，全程
走 /repositories/1435969436 数字 ID）。
"""
import sys

sys.path.insert(0, "/home/z/my-project/scripts")
import importlib.util

spec = importlib.util.spec_from_file_location(
    "apiv1312", "/home/z/my-project/scripts/api-push-v1312.py"
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)  # 需要 GH_TOKEN 已设置（模块级检查）

gh, git, push_commit = mod.gh, mod.git, mod.push_commit
API = mod.API

COMMITS = sys.argv[1:] or sys.exit("用法: push-main-only.py <提交SHA>...")


def main():
    code, ref = gh("GET", f"{API}/git/ref/heads/main")
    remote_tip = ref["object"]["sha"]
    parent0 = git("rev-parse", f"{COMMITS[0]}^")
    code, rc = gh("GET", f"{API}/git/commits/{remote_tip}")
    remote_tree = rc.get("tree", {}).get("sha", "?")
    local_tree = git("rev-parse", f"{parent0}^{{tree}}")

    # 快进闸：允许「远端基树与本地父树存在分歧」，但分歧文件必须全部被
    # 本次推送的提交变更覆盖 —— 否则 diff 复刻会让分歧残留到新 tip
    # （上例：v1.3.12 文档推送期 next-env.d.ts 的构建版/dev 版分叉）
    if remote_tree != local_tree:
        print(f"⚠ 远端基树 {remote_tree[:10]} ≠ 本地父树 {local_tree[:10]}，核查分歧…")
        def flat_local(tree_sha):
            out = git("-c", "core.quotePath=false", "ls-tree", "-r", tree_sha)
            m = {}
            for line in out.splitlines():
                meta, path = line.split("\t", 1)
                mode, typ, sha = meta.split()
                m[path.strip('"')] = (mode, sha)
            return m
        code, rt = gh("GET", f"{API}/git/trees/{remote_tree}?recursive=1")
        rmap = {e["path"]: (e["mode"], e["sha"]) for e in rt.get("tree", []) if e["type"] == "blob"}
        lmap = flat_local(local_tree)
        diverged = sorted(
            p for p in set(rmap) & set(lmap) if rmap[p] != lmap[p]
        ) + sorted(set(rmap) ^ set(lmap))
        changed = set(
            git("-c", "core.quotePath=false", "diff", "--name-only", parent0, *COMMITS).splitlines()
        )
        residue = [p for p in diverged if p not in changed]
        if residue:
            raise RuntimeError(f"分歧文件未被本次提交覆盖，中止: {residue}")
        print(f"  分歧 {diverged} 全部被提交变更覆盖 → 复刻后收敛为同树 ✓")
    else:
        print(f"✓ 远端 main={remote_tip[:10]}（树与本地一致），快进基座确认")

    tip = remote_tip
    for c in COMMITS:
        print(f"── 复刻提交 {c[:10]}：{git('log', '-1', '--format=%s', c)[:60]}")
        tip = push_commit(git("rev-parse", f"{c}^"), c, tip)

    print("── 更新 refs/heads/main ──")
    code, r = gh("PATCH", f"{API}/git/refs/heads/main", {"sha": tip, "force": False})
    if code not in (200, 201):
        raise RuntimeError(f"ref 更新失败: {r}")
    print(f"✓ main → {tip[:10]}")

    # 回读复核：远端 tip 树必须与本地提交树完全一致（硬失败）
    code, rc = gh("GET", f"{API}/git/commits/{tip}")
    rtree = rc.get("tree", {}).get("sha", "?")
    ltree = git("rev-parse", f"{COMMITS[-1]}^{{tree}}")
    if rtree != ltree:
        raise RuntimeError(f"回读复核失败：远端树 {rtree[:10]} ≠ 本地 {ltree[:10]}")
    print(f"✓ 回读复核：远端树 {rtree[:10]} == 本地树（同树确认）")


if __name__ == "__main__":
    main()
