#!/usr/bin/env python3
"""regress-v1314.py — v1.3.14 专项回归（在断网 netns 内对交付包运行）

本轮主题：安全加固落地验证（路径遍历修复 + 安全响应头）+ 既有全部防回归：
  1. v1.3.14 安全响应头：首页与 API 均携带 nosniff / X-Frame-Options DENY /
     no-referrer / Permissions-Policy（仅麦克风）/ CSP —— 其中 connect-src 'self'
     是「全程零外连」离线声明的传输层强制执行；
  2. v1.3.14 caseNo 格式闸：全部 [caseNo] 路由对遍历载荷 400 早退，
     良构但不存在编号保持 404 语义（对交付物实测，非仅源码断言）；
  3. 引擎 v2.0 口径（v1.3.12 起防回归）：engineVersion=v2.0.0-calibrated、
     11 维特征剖面、f0Std/shimmer/envMod45 在场；
  4. 合成通道下线（v1.3.11 起防回归）：路由 404 + chunk 零残留；
  5. 自检四项口径（v1.3.11 起防回归）；
  6. 并发存证竞态（v1.3.9 起防回归）；
  7. 存证包 ZIP（v1.3.9 起防回归）；
  8. 请求体早期上限（v1.3.9 起防回归）。
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


# ── 1. v1.3.14 安全响应头（首页 + API）───────────────────────────
print("═══ 1. 安全响应头（nosniff / DENY / referrer / permissions / CSP）═══")
try:
    hdr_ok = True
    for path in ("/", "/api/analyze"):
        code, _, hdrs = req(path)
        checks = {
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
            "referrer-policy": "no-referrer",
        }
        for k, want in checks.items():
            got = hdrs.get(k, "")
            if got != want:
                hdr_ok = False
                print(f"  [{path} {k}] ✗ 期望 {want} 实得 {got!r}")
        pp = hdrs.get("permissions-policy", "")
        if "microphone=(self)" not in pp or "camera=()" not in pp:
            hdr_ok = False
            print(f"  [{path} permissions-policy] ✗ {pp!r}")
        csp = hdrs.get("content-security-policy", "")
        for must in ("connect-src 'self'", "frame-ancestors 'none'", "object-src 'none'",
                     "script-src 'self'", "media-src 'self' blob:"):
            if must not in csp:
                hdr_ok = False
                print(f"  [{path} CSP] ✗ 缺少 {must!r}")
        if code != 200:
            hdr_ok = False
            print(f"  [{path}] ✗ HTTP {code}")
    print(f"  [五项头×2路由]  {'✓' if hdr_ok else '✗'} nosniff/DENY/no-referrer/permissions(mic only)/CSP 齐全"
          " · connect-src 'self' = 零外连声明的传输层强制")
    (PASS if hdr_ok else FAIL).append("安全响应头")
except Exception as e:
    print(f"  ✗ {e}")
    FAIL.append("安全响应头")

# ── 2. v1.3.14 caseNo 格式闸（路径遍历载荷 400 · 良构 404）──────
print("═══ 2. caseNo 格式闸（遍历载荷 → 400，良构不存在 → 404）═══")
try:
    attacks = [
        "/api/evidence/..%2F..%2F..%2Fetc%2Fpasswd",
        "/api/evidence/..%5C..%5Cwindows%5Csystem32",
        "/api/verify/..%2Fx",
        "/api/cases/..%2F..%2Fetc%2Fpasswd",
        "/api/evidence-package/..%2Fsecret",
        "/api/evidence/SS-20260101-0001%2F..%2F..%2Fsecret",
        "/api/evidence/SS-20260101-0001%00.wav",
    ]
    gate_ok = True
    for a in attacks:
        code, raw, _ = req(a)
        ok = code == 400 and "无效的案件编号" in raw.decode("utf-8", "replace")
        if not ok:
            gate_ok = False
            print(f"  [攻击] {a} → HTTP {code} ✗（期望 400）")
    print(f"  [遍历载荷×{len(attacks)}] {'✓' if gate_ok else '✗'} 全部 400 早退（含 NUL 截断 / 反斜杠 / 合法编号拼路径段）")
    # 良构但不存在：evidence/cases/evidence-package 三路由 404（案例不存在）；
    # verify 路由按设计返回 200 + verified=false（「核验未通过」是结论而非服务错误）
    b1 = req("/api/evidence/SS-20260101-9999")
    b2 = req("/api/cases/SS-20260101-9999")
    b3 = req("/api/verify/SS-20260101-9999")
    b4 = req("/api/evidence-package/SS-20260101-9999")
    not_found_ok = b1[0] == 404 and b2[0] == 404 and b4[0] == 404
    try:
        vj = json.loads(b3[1])
        verify_semantics_ok = b3[0] == 200 and vj.get("verified") is False
    except Exception:
        verify_semantics_ok = False
    fmt_ok = not_found_ok and verify_semantics_ok
    print(f"  [良构不存在]    {'✓' if fmt_ok else '✗'} evidence/cases/pkg={[b1[0], b2[0], b4[0]]}（应 404）"
          f" · verify={b3[0]}+verified={str(verify_semantics_ok and vj.get('verified'))}（应 200+False，语义不被误伤）")
    if gate_ok and fmt_ok:
        PASS.append("caseNo格式闸")
    else:
        FAIL.append("caseNo格式闸")
except Exception as e:
    print(f"  ✗ {e}")
    FAIL.append("caseNo格式闸")

# ── 3. 引擎 v2.0 口径（版本 + 特征集）────────────────────────────
print("═══ 3. 引擎 v2.0 口径（版本号 + 11 维特征剖面）═══")
try:
    code, raw, _ = req("/api/selfcheck")
    d = json.loads(raw)
    ver_ok = d.get("engineVersion") == "v2.0.0-calibrated"
    print(f"  [引擎版本]     {'✓' if ver_ok else '✗'} selfcheck engineVersion={d.get('engineVersion')}（应为 v2.0.0-calibrated）")

    code, raw, _ = req("/api/analyze", {"pcmB64": sine_pcm_b64(), "sourceType": "UPLOAD",
                                        "sourceLabel": "v1.3.14 特征口径回归", "fileName": "feat-probe.bin"})
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

# ── 4. 合成通道下线（v1.3.11 起防回归）──────────────────────────
print("═══ 4. 合成通道下线（路由 404 + chunk 零残留）═══")
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

# ── 5. 自检四项口径（无合成项 · 全绿）────────────────────────────
print("═══ 5. 系统自检四项口径 ═══")
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

# ── 6. 并发存证竞态（v1.3.9 起防回归）────────────────────────────
print("═══ 6. 并发存证竞态（6 并发 · 编号唯一 · 证据零污染）═══")
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
        "notes": "v1.3.14 并发竞态回归",
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

# ── 7. 证据核验 + 存证包 ZIP（v1.3.9 起防回归）──────────────────
print("═══ 7. 证据核验与存证包 ZIP ═══")
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

# ── 8. 请求体早期上限（v1.3.9 起防回归）──────────────────────────
print("═══ 8. 请求体早期上限（>16MiB → 413，不进解码）═══")
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
print(f"═══ v1.3.14 专项回归：{len(PASS)} 通过 / {len(FAIL)} 失败 ═══")
for f in FAIL:
    print(f"  ✗ {f}")
sys.exit(1 if FAIL else 0)
