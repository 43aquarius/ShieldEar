#!/usr/bin/env python3
"""parallel_fetch.py — 多线程分段下载器（攻克单线程限速）
用法: python3 parallel_fetch.py <url> <输出文件> <总大小> [线程数]

对 GitHub API 资产 URL：先解析 302 拿 CDN 签名直链，并行下载全部走 CDN，
避免 12 个并发打到 api.github.com 触发二级限流（返回 JSON 元数据污染分段）。
"""
import sys, os, threading, urllib.request, time

url, out, total = sys.argv[1], sys.argv[2], int(sys.argv[3])
threads = int(sys.argv[4]) if len(sys.argv) > 4 else 8

# GitHub API 资产端点 → 解析 302 拿 CDN 直链（仅一次 API 调用）
if "api.github.com" in url and "/assets/" in url:
    req = urllib.request.Request(url, headers={
        "Accept": "application/octet-stream", "User-Agent": "parallel-fetch"})
    resp = urllib.request.urlopen(req, timeout=60)
    if resp.url != url:  # 已跟随重定向 → 拿到 CDN 签名直链
        url = resp.url
        print(f"[redirect] CDN 直链已获取（后续不再触碰 API）")

seg = (total + threads - 1) // threads
tmpdir = out + ".parts"
os.makedirs(tmpdir, exist_ok=True)
ok = [False] * threads
errs = []

def fetch(i):
    start, end = i * seg, min((i + 1) * seg - 1, total - 1)
    if start > end:
        ok[i] = True
        return
    part = f"{tmpdir}/p{i:02d}"
    have = os.path.getsize(part) if os.path.exists(part) else 0
    need = end - start + 1
    for attempt in range(6):
        if have >= need:
            ok[i] = True
            return
        try:
            req = urllib.request.Request(url, headers={
                "Range": f"bytes={start+have}-{end}",
                "User-Agent": "parallel-fetch",
            })
            with urllib.request.urlopen(req, timeout=90) as r, open(part, "ab") as f:
                # 防污染：GitHub API 意外返回 JSON 元数据时丢弃重试
                first = r.read(1)
                if first == b"{":
                    errs.append(f"seg{i}: got JSON (attempt {attempt}), skip")
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
        except Exception as e:
            errs.append(f"seg{i}: {e}")
            time.sleep(1.5)
    ok[i] = os.path.getsize(part) >= need if os.path.exists(part) else False

ts = [threading.Thread(target=fetch, args=(i,)) for i in range(threads)]
t0 = time.time()
for t in ts:
    t.start()
for t in ts:
    t.join()
done = sum(1 for x in ok if x)
print(f"段完成: {done}/{threads} · 用时 {time.time()-t0:.1f}s" + (f" · 错误: {errs[:3]}" if errs else ""))
if done == threads:
    with open(out, "wb") as f:
        for i in range(threads):
            part = f"{tmpdir}/p{i:02d}"
            if os.path.exists(part):
                with open(part, "rb") as p:
                    f.write(p.read())
    sz = os.path.getsize(out)
    print(f"✓ 合并完成: {out} · {sz}B ({sz/1048576:.2f}MB)")
    import shutil
    shutil.rmtree(tmpdir)
else:
    sys.exit(1)
