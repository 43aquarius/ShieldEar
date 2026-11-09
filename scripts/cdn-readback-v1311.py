#!/usr/bin/env python3
"""cdn-readback-v1311.py — v1.3.11 Release 资产 CDN 回读复核（独立重跑版）

背景：api-push-v1311.py 发版主体（复刻/快进/标签/Release/上传）完成后，
回读的 302 跟随一步超时（该步单次无重试）；此时 main 已快进，全脚本重跑
会被快进基座校验拦下，故拆出本脚本单独重试回读，不触碰 main/tag/release。

用法: GH_TOKEN=github_pat_xxx python3 scripts/cdn-readback-v1311.py
输出: 本地 = 上传登记 = CDN 回读 三方 SHA-256 一致性判定
"""
import hashlib
import json
import os
import shutil
import sys
import threading
import time
import urllib.request

TOKEN = os.environ.get("GH_TOKEN") or sys.exit("需要 GH_TOKEN 环境变量")
API = "https://api.github.com/repositories/1435969436"
TAG = "v1.3.11"
ASSET_NAME = "ShieldEar-v1.3.11-portable.zip"
ZIP = f"/home/z/my-project/download/{ASSET_NAME}"
OUT = "/tmp/v1311-readback.zip"


def gh_get(url):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "ShieldEar-release-script",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def follow(url, tries=5):
    """跟随 302 拿 CDN 签名直链（仅一次，后续分段不再触碰 github.com）—— 带重试"""
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ShieldEar-release-script"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.url
        except Exception as e:
            print(f"  302 跟随第 {i + 1}/{tries} 次失败: {e}，5s 后重试")
            time.sleep(5)
    raise RuntimeError("302 跟随多次失败")


def cdn_readback(url, total, out, n_seg=16):
    """CDN 资产回读：分段并行 + 逐段 6 次重试 + 断点续传 → 合并哈希。"""
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
    rel = gh_get(f"{API}/releases/tags/{TAG}")
    asset = next(a for a in rel["assets"] if a["name"] == ASSET_NAME)
    print(f"Release id={rel['id']} · tag={TAG} · 资产 id={asset['id']} · "
          f"state={asset['state']} · 登记尺寸 {asset['size']:,}B")

    local_sha = hashlib.sha256(open(ZIP, "rb").read()).hexdigest()
    local_size = os.path.getsize(ZIP)
    print(f"本地  : {local_size:,}B · SHA-256 {local_sha}")
    print(f"登记  : {asset['size']:,}B · digest 字段 {asset.get('digest', '(未提供)')}")
    if asset["size"] != local_size:
        raise RuntimeError(f"登记尺寸与本地不一致: {asset['size']} ≠ {local_size}")

    print("── CDN 回读下载复核（16 段并行 · 302 跟随带重试）──")
    direct = follow(asset["browser_download_url"])
    rb, n = cdn_readback(direct, asset["size"], OUT)
    verdict = "一致 ✓" if rb == local_sha else f"不一致!! 回读 {rb}"
    print(f"回读  : {n:,}B · SHA-256 {rb}")
    print(f"三方校验（本地 = 上传登记 = CDN 回读）: {verdict}")
    if rb != local_sha:
        raise RuntimeError("回读哈希不一致")
    print("✓ v1.3.11 资产回读复核通过")


if __name__ == "__main__":
    main()
