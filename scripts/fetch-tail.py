#!/usr/bin/env python3
"""fetch-tail.py — 经 api.github.com 资产端点拿签名直链，下载 zip 尾部（中央目录）
通道：Basic 认证 + 查询串缓存穿透（Bearer 头会被中间层负缓存假 404）。
产物: /tmp/tail-test.bin + /tmp/asset-direct-url.txt（供 recover-build-assets.py 复用）
"""
import json, struct, subprocess, sys, time, os

TOKEN = os.environ["GH_TOKEN"]
API = "https://api.github.com/repos/43aquaris/ShieldEar"
BUST = str(int(time.time() * 1000) % 100000000)

def curl_json(url, tries=8):
    for i in range(tries):
        r = subprocess.run(["curl", "-s", "--max-time", "60",
                            "-u", f"43aquarius:{TOKEN}",
                            f"{url}{'&' if '?' in url else '?'}_b={BUST}{i}"],
                           capture_output=True, text=True)
        try:
            d = json.loads(r.stdout)
            if isinstance(d, dict) and "id" in d:
                return d
        except Exception:
            pass
        time.sleep(3)
    return None

# 1. release 元数据（拿资产 id 与精确大小）
rel = curl_json(f"{API}/releases/tags/v1.3.6")
if not rel or "id" not in rel:
    print("✗ 无法获取 v1.3.6 release 元数据"); sys.exit(1)
asset = next(a for a in rel["assets"] if a["name"] == "ShieldEar-v1.3.6-portable.zip")
aid, size = asset["id"], asset["size"]
print(f"asset id={aid} size={size:,}B state={asset['state']}")

# 2. API 资产端点 302 → 签名 CDN 直链（不走 github.com 主站）
direct = ""
for i in range(10):
    r = subprocess.run(["curl", "-s", "--max-time", "60", "-o", "/dev/null",
                        "-w", "%{redirect_url}",
                        "-u", f"43aquarius:{TOKEN}",
                        "-H", "Accept: application/octet-stream",
                        f"https://api.github.com/repos/43aquaris/ShieldEar/releases/assets/{aid}"],
                       capture_output=True, text=True).stdout.strip()
    if r.startswith("https://"):
        direct = r
        break
    time.sleep(3)
if not direct:
    print("✗ 无法解析 CDN 直链"); sys.exit(1)
open("/tmp/asset-direct-url.txt", "w").write(direct)
print(f"CDN 直链就绪（已存 /tmp/asset-direct-url.txt）: {direct[:80]}…")

# 3. 下载尾部（最后 2MB，含中央目录）
TAIL = 2_000_000
start = size - TAIL
out = "/tmp/tail-test.bin"
for i in range(8):
    rc = subprocess.run(["curl", "-s", "--max-time", "300",
                         "-r", f"{start}-", "-o", out, direct]).returncode
    if rc == 0 and os.path.exists(out) and os.path.getsize(out) > 1_000_000:
        break
    time.sleep(3)
else:
    print("✗ 尾部下载失败"); sys.exit(1)

# 4. 校验 EOCD + 中央目录完整性
d = open(out, "rb").read()
i = d.rfind(b"PK\x05\x06")
assert i >= 0, "EOCD 不在尾部"
n_this, n_total, cd_size, cd_off = struct.unpack("<HHII", d[i+8:i+22])
print(f"✓ tail {len(d):,}B · EOCD@{i} · 成员 {n_total} · cd_size={cd_size:,} · cd_abs_off={cd_off:,}")
assert i - cd_size >= 0, "中央目录不完整（加大 TAIL）"
tail_abs_start = size - len(d)
assert cd_off >= tail_abs_start, f"CD 起始({cd_off:,}) 早于尾部窗口({tail_abs_start:,})"
print("✓ /tmp/tail-test.bin 就绪（CD 完整包含）")
