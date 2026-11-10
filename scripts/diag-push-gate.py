#!/usr/bin/env python3
"""diag-push-gate.py — 诊断 push-main-only.py 快进闸分歧（2026-11-10 v1.3.15 推送轮）

取证三问：
  1. 远端 c946325 基树 vs 本地 da1fd45 树：17 个分歧文件逐个 (mode, sha) 对照 —— mode 漂移还是内容差异？
  2. 远端基树 vs 本地 HEAD 树：推送后必须收敛的全集有多大？
  3. `git diff --name-only A c1..c8`（多 commit 参数）实际行为 —— 是否被当作 pathspec 导致 changed=∅？
"""
import json
import subprocess
import urllib.request

TOKEN = open("/home/z/my-project/.secrets/github_pat").read().strip()
API = "https://api.github.com/repositories/1435969436"
GIT_DIR = "/home/z/my-project"


def gh(method, url):
    req = urllib.request.Request(url, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "ShieldEar-diag",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, json.loads(r.read())


def git(*args):
    r = subprocess.run(["git", "-C", GIT_DIR, *args], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:3])}… 失败: {r.stderr.decode()[:200]}")
    return r.stdout.decode()


def lmap(treeish):
    out = git("-c", "core.quotePath=false", "ls-tree", "-r", treeish)
    m = {}
    for line in out.splitlines():
        meta, path = line.split("\t", 1)
        mode, typ, sha = meta.split()
        m[path.strip('"')] = (mode, sha)
    return m


code, ref = gh("GET", f"{API}/git/ref/heads/main")
tip = ref["object"]["sha"]
code, rc = gh("GET", f"{API}/git/commits/{tip}")
rtree = rc["tree"]["sha"]
code, rt = gh("GET", f"{API}/git/trees/{rtree}?recursive=1")
print(f"远端 main={tip[:10]} tree={rtree[:10]} truncated={rt.get('truncated')} entries={len(rt['tree'])}")
rmap = {e["path"]: (e["mode"], e["sha"]) for e in rt["tree"] if e["type"] == "blob"}

l0 = lmap("da1fd45")
lH = lmap("HEAD")

div_base = sorted(p for p in set(rmap) & set(l0) if rmap[p] != l0[p]) + sorted(set(rmap) ^ set(l0))
div_head = sorted(p for p in set(rmap) & set(lH) if rmap[p] != lH[p]) + sorted(set(rmap) ^ set(lH))
print(f"\n【问1/2】远端 vs da1fd45 分歧 {len(div_base)} 个；远端 vs HEAD 分歧 {len(div_head)} 个")
for p in div_base:
    r, a, h = rmap.get(p), l0.get(p), lH.get(p)
    kind = "MODE" if r and a and r[1] == a[1] else "CONTENT"
    print(f"  [{kind}] {p}")
    print(f"      remote={r}  d45={a}  HEAD={h}")

print("\n【问3】多 commit 参数 diff 行为：")
out_multi = git("diff", "--name-only", "da1fd45", "151d433", "3c0a2a8", "8f97244",
                "d19bb9b", "983067a", "61a5ba7", "844519f", "25f02df").strip()
out_pair = git("-c", "core.quotePath=false", "diff", "--name-only", "da1fd45", "25f02df").strip()
print(f"  多参数形式：{len(out_multi.splitlines()) if out_multi else 0} 行")
print(f"  两两形式(da1fd45..25f02df)：{len(out_pair.splitlines())} 行")
print(f"  两两形式文件清单：")
for p in out_pair.splitlines():
    print(f"    {p}")
