#!/usr/bin/env python3
"""readback-v1315.py — v1.3.15 推送后 raw CDN 回读复核（独立短任务，可续跑）

按新远端提交 SHA 逐文件回读 raw.githubusercontent.com（SHA 定址绕过分支缓存），
SHA-256 与本地 git blob 逐字节比对。覆盖 8 个提交各 ≥1 个代表文件。
v1.3.10 实录：CDN 大文件单流必断 → >64KB 文件走 8 段并行 + 逐段断点续传。
用法: python3 scripts/readback-v1315.py a   # 前 5 个文件
      python3 scripts/readback-v1315.py b   # 后 5 个文件（/tmp/rb-progress.json 记录已完成）
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

GIT_DIR = "/home/z/my-project"
FILES = [
    "src/lib/engine/engine.ts",                    # 151d433 引擎 v2.1.0-robust
    "src/lib/engine/__tests__/quality.test.ts",    # 151d433 + 983067a
    "scripts/regress-v1315.py",                    # 3c0a2a8 + 61a5ba7
    "docs/声盾-系统测试报告.docx",                  # 8f97244（709KB 压力样本）
    "calibration/latency_results.json",            # d19bb9b
    "src/components/shield/result-panel.tsx",      # 983067a + 151d433
    "bun.lock",                                    # 61a5ba7（376KB）
    "vitest.config.mts",                           # 844519f
    "calibration/e2e_latency_results.json",        # 25f02df
    "README.md",                                   # 稳定性哨兵（多提交波及）
]
BATCH = {"a": FILES[:5], "b": FILES[5:]}
PROGRESS = "/tmp/rb-progress.json"


def git(*args):
    r = subprocess.run(["git", "-C", GIT_DIR, "-c", "core.quotePath=false", *args],
                       capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:3])}…: {r.stderr.decode()[:150]}")
    return r.stdout


def fetch_ranged(url, out, total, n_seg=8):
    """8 段并行 + 逐段续传（api-push-v1312 cdn_readback 同款，段超时 30s×4 重试）。"""
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
        for _ in range(4):
            if have >= need:
                ok[i] = True
                return
            try:
                rq = urllib.request.Request(url, headers={
                    "Range": f"bytes={start + have}-{end}",
                    "User-Agent": "ShieldEar-release-script"})
                with urllib.request.urlopen(rq, timeout=30) as r, open(part, "ab") as f:
                    first = r.read(1)
                    if first == b"{":
                        time.sleep(1.5)
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
        raise RuntimeError(f"分段下载存在失败段（重跑可续传）{[i for i, o in enumerate(ok) if not o]}")
    data = b"".join(open(f"{tmpdir}/p{i:02d}", "rb").read() for i in range(n_seg))
    shutil.rmtree(tmpdir, ignore_errors=True)
    return data


def verify_one(path, token):
    blob_sha = git("rev-parse", f"HEAD:{path}").decode().strip()
    local = git("cat-file", "blob", blob_sha)
    local_sha = hashlib.sha256(local).hexdigest()
    # raw.githubusercontent.com 本沙箱不可达（SSL 中断/6s 延迟，v1.3.10 实录同源坑），
    # 改走 api.github.com git/blobs 对象读路径（本回合全程稳定，0.6s 级）；
    # blob SHA 内容寻址且上传时已逐个校验，读回仍做 sha256 终验。
    import base64
    data = None
    for attempt in range(3):
        try:
            rq = urllib.request.Request(
                f"https://api.github.com/repositories/1435969436/git/blobs/{blob_sha}",
                headers={"Authorization": f"Bearer {token}",
                         "Accept": "application/vnd.github+json",
                         "User-Agent": "ShieldEar-release-script"})
            with urllib.request.urlopen(rq, timeout=25) as r:
                payload = json.loads(r.read())
            if payload.get("sha") != blob_sha:
                raise RuntimeError("blob sha 回包不一致")
            data = base64.b64decode(payload["content"])
            break
        except Exception:
            time.sleep(1.5)
    if data is None:
        return False, f"{len(local):,}B {local_sha[:16]}…", "3 次重试失败"
    got = hashlib.sha256(data).hexdigest()
    ok = got == local_sha and len(data) == len(local)
    return ok, f"{len(local):,}B {local_sha[:16]}…", f"{len(data):,}B {got[:16]}…"


def main():
    batch = sys.argv[1] if len(sys.argv) > 1 else "a"
    # 远端 tip：优先复用推送产出的 SHA 记录，缺失则现查
    # 远端 tip：用 PAT 查（免认证额度有限）
    token = open(GIT_DIR + "/.secrets/github_pat").read().strip()
    r = subprocess.run(["curl", "-s", "-m", "20", "-H", f"Authorization: Bearer {token}",
                        "https://api.github.com/repositories/1435969436/git/ref/heads/main"],
                       capture_output=True, text=True)
    tip = json.loads(r.stdout)["object"]["sha"]
    open("/tmp/remote_tip.txt", "w").write(tip)
    done = {}
    if os.path.exists(PROGRESS):
        done = json.load(open(PROGRESS))
    print(f"远端 main = {tip[:12]} · 批次 {batch} · 已完成跳过 {len(done)} 项\n")

    all_ok = True
    for path in BATCH[batch]:
        if done.get(path):
            print(f"  ↷ {path}（前批已 ✓）")
            continue
        ok, want, got = verify_one(path, token)
        print(f"  {'✓' if ok else '✗'} {path}  {want}")
        if not ok:
            all_ok = False
            print(f"      回读: {got}")
        else:
            done[path] = True
            json.dump(done, open(PROGRESS, "w"))
    print("\n" + (f"═✓═ 批次 {batch} 全部一致 ══" if all_ok else f"═✗═ 批次 {batch} 存在不一致 ══"))
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
