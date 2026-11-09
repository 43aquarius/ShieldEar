#!/usr/bin/env python3
"""regress-v1312.py — v1.3.12 专项回归（在断网 netns 内对交付包运行）

本轮主题：引擎 v2.0.0-calibrated 学术增强落地验证 + 既有通用防回归：
  1. 引擎 v2.0 口径：selfcheck 报告 engineVersion=v2.0.0-calibrated；
     /api/analyze 判决含 11 维特征剖面，且 f0Std/shimmer/envMod45 三新键在场；
  2. 合成通道下线（v1.3.11 起防回归）：/api/tts-challenge 与 /api/config/cloud
     均 404，服务端 chunk 无 tts-challenge/espeak 字面量残留；
  3. 自检四项口径（v1.3.11 起防回归）：无「本地合成引擎」项，四项全绿；
  4. 并发存证竞态（v1.3.9 起防回归）：6 并发，编号唯一、证据零交叉污染；
  5. 存证包 ZIP（v1.3.9 起防回归）：结构、SHA256SUMS 自洽、记录锚定；
  6. 请求体早期上限（v1.3.9 起防回归）：>16MiB → 413。
前置（由 test-offline-portable.sh 完成）：解压树位于
/tmp/zip-verify/ShieldEar（chunk 静态检查直接读该树）。
"""
import base64
import glob
import hashlib
import io
import json
import math
import os
import socket
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile

BASE = "http://127.0.0.1:3000"
STAGE = "/tmp/zip-verify/ShieldEar"
PASS, FAIL = [], []


def req(path, body=None, timeout=120):
    if body is not None:
        data = json.dumps(body).encode()
    else:
        data = None
    r = urllib.request.Request(BASE + path, data=data,
                               headers={"Content-Type": "application/json"}, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read(), {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as e:
        try:
            return e.code, e.read(), {k.lower(): v for k, v in e.headers.items()}
        except Exception:
            return e.code, b"", {}
    except Exception as e:
        return -1, str(e).encode(), {}


def sine_pcm_b64(freq=440.0, sec=3.0, rate=16000):
    n = int(sec * rate)
    frames = bytearray()
    for i in range(n):
        v = int(12000 * math.sin(2 * math.pi * freq * i / rate))
        frames += struct.pack("<h", v)
    return base64.b64encode(bytes(frames)).decode()


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# ── 1. 引擎 v2.0 口径（版本 + 特征集）────────────────────────────
print("═══ 1. 引擎 v2.0 口径（版本号 + 11 维特征剖面）═══")
try:
    code, raw, _ = req("/api/selfcheck")
    d = json.loads(raw)
    ver_ok = d.get("engineVersion") == "v2.0.0-calibrated"
    print(f"  [引擎版本]     {'✓' if ver_ok else '✗'} selfcheck engineVersion={d.get('engineVersion')}（应为 v2.0.0-calibrated）")

    code, raw, _ = req("/api/analyze", {"pcmB64": sine_pcm_b64(), "sourceType": "UPLOAD",
                                        "sourceLabel": "v2.0 特征口径回归", "fileName": "feat-probe.bin"})
    d2 = json.loads(raw)
    prof = d2.get("analysis", {}).get("featureProfile", [])
    keys = {p.get("key") for p in prof}
    feat_ok = (len(prof) == 11 and {"f0Std", "shimmer", "envMod45"} <= keys)
    print(f"  [特征剖面]     {'✓' if feat_ok else '✗'} {len(prof)} 维特征 · 新键在场: "
          f"{sorted({'f0Std', 'shimmer', 'envMod45'} & keys)}")
    if ver_ok and feat_ok:
        PASS.append("引擎v2.0口径")
    else:
        FAIL.append("引擎v2.0口径")
except Exception as e:
    print(f"  ✗ {e}")
    FAIL.append("引擎v2.0口径")

# ── 2. 合成通道下线（v1.3.11 起防回归）──────────────────────────
print("═══ 2. 合成通道下线（路由 404 + chunk 零残留）═══")
try:
    code, raw, _ = req("/api/tts-challenge", {"text": "下线验证", "voice": "tongtong"})
    code2, raw2, _ = req("/api/config/cloud", {"enabled": True})
    route_ok = code == 404 and code2 == 404
    print(f"  [路由下线]     {'✓' if route_ok else '✗'} tts-challenge={code} · config/cloud={code2}（均应为 404）")

    chunk_files = glob.glob(os.path.join(STAGE, "server", ".next", "server", "chunks", "*.js"))
    residue = []
    for p in chunk_files:
        text = open(p, encoding="utf-8", errors="replace").read()
        for lit in ("tts-challenge", "espeak", "ESPEAK_VOICE_MAP", "local-tts"):
            if lit in text:
                residue.append(f"{os.path.basename(p)}: {lit}")
    chunk_ok = not residue
    print(f"  [chunk 零残留] {'✓' if chunk_ok else '✗'} {len(chunk_files)} 个服务端 chunk 无合成代码残留"
          + (f"（{residue[:3]}）" if residue else ""))

    pkg_files = glob.glob(os.path.join(STAGE, "espeak-ng*")) + glob.glob(os.path.join(STAGE, "windows-smoke.cmd"))
    pkg_ok = not pkg_files
    print(f"  [交付树无合成] {'✓' if pkg_ok else '✗'} espeak-ng/ 与 windows-smoke.cmd 均不在包内"
          + (f"（发现 {pkg_files}）" if pkg_files else ""))

    if route_ok and chunk_ok and pkg_ok:
        PASS.append("合成通道下线")
    else:
        FAIL.append("合成通道下线")
except Exception as e:
    print(f"  ✗ {e}")
    FAIL.append("合成通道下线")

# ── 3. 自检四项口径（无合成项 · 全绿）────────────────────────────
print("═══ 3. 系统自检四项口径 ═══")
try:
    code, raw, _ = req("/api/selfcheck")
    d = json.loads(raw)
    names = [c["name"] for c in d["checks"]]
    no_synth = not any(("合成" in n or "espeak" in n.lower()) for n in names)
    all_ok = d.get("allOk") is True and d.get("total") == 4
    print(f"  [四项口径]     {'✓' if all_ok and no_synth else '✗'} {d.get('passed')}/{d.get('total')} 全绿 · 项: {names}")
    if all_ok and no_synth:
        PASS.append("自检四项口径")
    else:
        FAIL.append("自检四项口径")
except Exception as e:
    print(f"  ✗ {e}")
    FAIL.append("自检四项口径")

# ── 4. 并发存证竞态（v1.3.9 起防回归）────────────────────────────
print("═══ 4. 并发存证竞态（6 并发 · 编号唯一 · 证据零污染）═══")
N = 6
results = [None] * N
markers = [f"SRC-MARKER-{i}-".encode() + bytes([i]) * 512 for i in range(N)]
pcms = [sine_pcm_b64(freq=440 + 60 * i) for i in range(N)]


def worker(i):
    body = {
        "pcmB64": pcms[i],
        "sourceB64": base64.b64encode(markers[i]).decode(),
        "sourceType": "UPLOAD",
        "sourceLabel": f"并发回归·{i}",
        "fileName": f"concurrent-{i}.bin",
        "notes": "v1.3.12 并发竞态回归",
    }
    results[i] = req("/api/analyze", body)


threads = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
t0 = time.time()
for t in threads:
    t.start()
for t in threads:
    t.join()
elapsed = time.time() - t0

all_ok = True
caseNos = []
for i, (code, raw, _) in enumerate(results):
    try:
        d = json.loads(raw)
    except Exception:
        d = {}
    if code != 200 or "caseNo" not in d:
        all_ok = False
        print(f"  [并发{i}]       ✗ HTTP {code} · {str(raw)[:140]}")
        continue
    caseNos.append(d["caseNo"])
    src_ok = d.get("sourceHash") == sha256(markers[i]) and d.get("sourcePreserved") is True
    print(f"  [并发{i}]       {'✓' if src_ok else '✗'} HTTP {code} · {d['caseNo']} · srcHash{'一致' if src_ok else '不一致/未落盘'}")
    if not src_ok:
        all_ok = False

uniq = len(set(caseNos)) == len(caseNos) == N
print(f"  [编号唯一]     {'✓' if uniq else '✗'} {len(set(caseNos))}/{N}（{elapsed:.1f}s 内完成）")
clean = all(code == 200 for code, _, _ in results)
no_leak = all(b"prisma" not in raw.lower() and b"Invalid `" not in raw for _, raw, _ in results)
print(f"  [无Prisma泄漏] {'✓' if no_leak else '✗'}")
if all_ok and uniq and clean and no_leak:
    PASS.append("并发存证竞态")
else:
    FAIL.append("并发存证竞态")

# ── 5. 证据核验 + 存证包 ZIP（v1.3.9 起防回归）──────────────────
print("═══ 5. 证据核验与存证包 ZIP ═══")
verify_ok = package_ok = False
if caseNos:
    c0 = caseNos[0]
    try:
        code, raw, _ = req(f"/api/verify/{c0}")
        d = json.loads(raw)
        src_check = next((c for c in d.get("checks", []) if "原始来源" in c["name"]), None)
        verify_ok = d.get("verified") is True and src_check and src_check["status"] == "ok"
        print(f"  [证据核验]     {'✓' if verify_ok else '✗'} verified={d.get('verified')} · 原始来源={src_check['status'] if src_check else '缺失'}")
        (PASS if verify_ok else FAIL).append("证据核验·含原始来源")
    except Exception as e:
        print(f"  [证据核验]     ✗ {e}")
        FAIL.append("证据核验·含原始来源")

    try:
        code, raw, hdrs = req(f"/api/evidence-package/{c0}")
        is_zip = hdrs.get("content-type", "").startswith("application/zip") and raw[:2] == b"PK"
        zf = zipfile.ZipFile(io.BytesIO(raw))
        names = zf.namelist()
        need = ["case-record.json", "integrity-report.json", "SHA256SUMS.txt", "README.txt",
                f"{c0}_evidence.wav", f"{c0}_source.bin"]
        names_ok = all(n in names for n in need)
        sums_ok = True
        for line in zf.read("SHA256SUMS.txt").decode().splitlines():
            h, n = line.split("  ", 1)
            if sha256(zf.read(n)) != h:
                sums_ok = False
                print(f"    哈希失配: {n}")
        rec = json.loads(zf.read("case-record.json"))
        rec_ok = rec.get("audioHash") == sha256(zf.read(f"{c0}_evidence.wav")) and rec.get("sourceHash") == sha256(markers[0])
        package_ok = code == 200 and is_zip and names_ok and sums_ok and rec_ok
        print(f"  [存证包ZIP]    {'✓' if package_ok else '✗'} HTTP {code} · {len(raw)}B · 成员{len(names)} · 清单自洽={sums_ok} · 记录锚定={rec_ok}")
        (PASS if package_ok else FAIL).append("存证包ZIP")
    except Exception as e:
        print(f"  [存证包ZIP]    ✗ {e}")
        FAIL.append("存证包ZIP")
else:
    print("  （无案例可核验——前置并发测试失败）")
    FAIL.append("证据核验·含原始来源")
    FAIL.append("存证包ZIP")

# ── 6. 请求体早期上限（v1.3.9 起防回归）──────────────────────────
print("═══ 6. 请求体早期上限（>16MiB → 413，不进解码）═══")
try:
    s = socket.create_connection(("127.0.0.1", 3000), timeout=20)
    total = 17 * 1024 * 1024
    head = (
        f"POST /api/analyze HTTP/1.1\r\nHost: 127.0.0.1:3000\r\n"
        f"Content-Type: application/json\r\nContent-Length: {total}\r\n\r\n"
    ).encode()
    s.sendall(head)
    s.sendall(b'{"pcmB64":"' + b"A" * 65536)
    s.settimeout(15)
    resp = b""
    try:
        while b"\r\n\r\n" not in resp or len(resp) < 50:
            chunk = s.recv(4096)
            if not chunk:
                break
            resp += chunk
            if b"413" in resp.split(b"\r\n")[0] and b"\r\n\r\n" in resp:
                break
    except socket.timeout:
        pass
    s.close()
    status_line = resp.split(b"\r\n")[0].decode(errors="replace") if resp else "(无响应)"
    gate_ok = " 413 " in status_line or status_line.endswith("413")
    print(f"  [体积闸]       {'✓' if gate_ok else '✗'} 响应: {status_line}")
    (PASS if gate_ok else FAIL).append("请求体早期上限")
except Exception as e:
    print(f"  [体积闸]       ✗ {e}")
    FAIL.append("请求体早期上限")

# ── 汇总 ──────────────────────────────────────────────────────────
print()
print(f"═══ v1.3.12 专项回归：{len(PASS)} 通过 / {len(FAIL)} 失败 ═══")
for f in FAIL:
    print(f"  ✗ {f}")
sys.exit(1 if FAIL else 0)
