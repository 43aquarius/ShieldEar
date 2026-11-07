#!/usr/bin/env python3
"""regress-v139.py — v1.3.9 专项回归（在断网 netns 内对交付包运行）

覆盖真机审计坐实的四个缺陷的修复验证：
  1. 应用内合成挑战 live 模式（Turbopack 平台折叠根因）：
     selfcheck 第 4 项应为「发行包内组件」+ tts-challenge mode=live engine=espeak
  2. 并发存证竞态：6 个并发 analyze，编号唯一、证据无交叉污染、全部可核验
  3. 存证包 ZIP：结构、SHA256SUMS 自洽、与案例记录哈希一致
  4. 请求体早期上限：>16MiB 直接 413（不做全量解码）
前置（由 test-offline-portable.sh 完成）：包内 espeak-ng.exe 与 espeak-ng-data
已替换为 Linux 等价物（仅测试期；Windows 交付树由 zip 重建）。
"""
import base64
import hashlib
import io
import json
import math
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile

BASE = "http://127.0.0.1:3000"
PASS, FAIL = [], []


def req(path, body=None, timeout=120, raw_body=None):
    if raw_body is not None:
        data = raw_body
    elif body is not None:
        data = json.dumps(body).encode()
    else:
        data = None
    r = urllib.request.Request(BASE + path, data=data,
                                headers={"Content-Type": "application/json"}, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            # 注意：Next/Node 以【小写】输出响应头，统一小写化避免漏查
            return resp.status, resp.read(), {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as e:
        try:
            return e.code, e.read(), {k.lower(): v for k, v in e.headers.items()}
        except Exception:
            return e.code, b"", {}


def sine_pcm_b64(freq=440.0, sec=3.0, rate=16000):
    n = int(sec * rate)
    frames = bytearray()
    for i in range(n):
        v = int(12000 * math.sin(2 * math.pi * freq * i / rate))
        frames += struct.pack("<h", v)
    return base64.b64encode(bytes(frames)).decode()


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# ── 1. 合成挑战 live 模式 + selfcheck 发行包内组件 ──────────────────
print("═══ 1. 应用内合成通道（v1.3.9 根因修复验证）═══")
try:
    code, raw, _ = req("/api/selfcheck")
    d = json.loads(raw)
    item4 = next((c for c in d["checks"] if c["name"] == "本地合成引擎"), None)
    ok4 = bool(item4 and item4["ok"] and "发行包内组件" in item4["detail"])
    print(f"  [自检第4项]   {'✓' if ok4 else '✗'} ok={item4 and item4['ok']} · {item4['detail'] if item4 else '缺失'}")
    (PASS if ok4 else FAIL).append("自检·本地合成引擎(包内组件)")
except Exception as e:
    print(f"  [自检第4项]   ✗ {e}")
    FAIL.append("自检·本地合成引擎(包内组件)")

try:
    t0 = time.time()
    code, raw, _ = req("/api/tts-challenge", {
        "text": "您好，我是您的孙子，我遇到车祸急需三万元医药费，请马上转账到这个账户。",
        "voice": "tongtong", "speed": 1.0})
    d = json.loads(raw)
    live = d.get("mode") == "live" and d.get("engine") == "espeak"
    o = d["analysis"]["overall"]
    print(f"  [合成挑战]     {'✓' if live else '✗'} HTTP {code} · mode={d.get('mode')} engine={d.get('engine')}"
          f"({d.get('engineLabel')}) · risk={o['risk']} · caseNo={d['caseNo']} · {time.time()-t0:.1f}s")
    (PASS if live and code == 200 else FAIL).append("合成挑战·live模式")
except Exception as e:
    print(f"  [合成挑战]     ✗ {e}")
    FAIL.append("合成挑战·live模式")

# ── 2. 并发存证竞态 ────────────────────────────────────────────────
print("═══ 2. 并发存证竞态（6 并发 · 编号唯一 · 证据零污染）═══")
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
        "notes": "v1.3.9 并发竞态回归",
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
    # 原始来源哈希必须等于【本请求】字节的哈希（交叉污染即失配）
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

# ── 3. 证据核验 + 存证包 ZIP ──────────────────────────────────────
print("═══ 3. 证据核验与存证包 ZIP ═══")
verify_ok = package_ok = False
if caseNos:
    c0 = caseNos[0]
    try:
        code, raw, _ = req(f"/api/verify/{c0}")
        d = json.loads(raw)
        names = [c["name"] for c in d.get("checks", [])]
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
        # SHA256SUMS 自洽：清单内每个文件的哈希重算一致
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

# ── 4. 请求体早期上限 ─────────────────────────────────────────────
print("═══ 4. 请求体早期上限（>16MiB → 413，不进解码）═══")
try:
    import socket
    s = socket.create_connection(("127.0.0.1", 3000), timeout=20)
    total = 17 * 1024 * 1024
    head = (
        f"POST /api/analyze HTTP/1.1\r\nHost: 127.0.0.1:3000\r\n"
        f"Content-Type: application/json\r\nContent-Length: {total}\r\n\r\n"
    ).encode()
    s.sendall(head)
    # 只发一小段 body：服务端应在读完全部 body 之前就凭 Content-Length 拒绝
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
print(f"═══ v1.3.9 专项回归：{len(PASS)} 通过 / {len(FAIL)} 失败 ═══")
for f in FAIL:
    print(f"  ✗ {f}")
sys.exit(1 if FAIL else 0)
