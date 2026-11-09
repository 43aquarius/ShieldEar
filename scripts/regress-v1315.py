#!/usr/bin/env python3
"""regress-v1315.py — v1.3.15 专项回归（对 dev server 运行，python3 scripts/regress-v1315.py）

本轮主题：引擎 v2.1.0-robust 抗干扰鲁棒性落地验证（直流免疫 + 输入质量护栏）
+ 既有全部防回归。质量口径与 src/lib/engine/__tests__/quality.test.ts 同源：
  1. v1.3.15 引擎版本口径：selfcheck engineVersion=v2.1.0-robust + 自检四项全绿；
  2. v1.3.15 质量护栏在场：analyze 响应 analysis.quality 四项指标齐全，
     真实校准音频（tts_tongtong_0.wav，探针 clean 同源，24k→16k ffmpeg 重采样）
     四项诊断全清（warnings == []，平顶比 0.0014% / 底噪 -84.5dB 复刻口径）；
  3. v1.3.15 直流免疫：+0.05 直流后 risk 与语音窗数与 clean 完全一致
     （ratio 漂移 <0.02，quality.test.ts 同款断言），且 dc 版精确报 ["dc-offset"]、
     clean 版无警示；恒定直流静音不再击穿静音闸（voicedWindows=0、risk=LOW，
     警示含 dc-offset——0.05 恒值峰值 -26dBFS 同时合法触发 low-level）；
  4. v1.3.15 触发矩阵：硬削波 ±0.15 → clipping；×0.05 低电平 → 精确
     ["low-level"]（平顶比统计自动关闭，clippingRatio=0）；白噪底 RMS 0.03
     （LCG 与测试套件同款）→ 精确 ["noisy-floor"]；四输入判决管道均不崩；
  5. v1.3.14 防回归：安全响应头五项（nosniff/DENY/no-referrer/permissions/CSP）；
  6. v1.3.14 防回归：caseNo 格式闸（遍历载荷 400 / 良构不存在 404 / verify 200+false）；
  7. v2.0 防回归：11 维特征剖面（f0Std/shimmer/envMod45 在场）；
  8. v1.3.9 防回归：并发存证 6 路 · 编号唯一 · srcHash 锚定 + 证据核验 + 存证包 ZIP；
  9. v1.3.9 防回归：请求体早期上限（>16MiB → 413）。
"""
import base64
import io
import json
import math
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile
import wave

BASE = "http://127.0.0.1:3000"
ROOT = "/home/z/my-project"
CLEAN_WAV = f"{ROOT}/calibration/audio/tts_tongtong_0.wav"
PASS, FAIL = [], []


def req(path, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data,
                               headers={"Content-Type": "application/json"},
                               method="POST" if data else "GET")
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


def pcm_to_b64(samples):
    return base64.b64encode(struct.pack(f"<{len(samples)}h", *[max(-32768, min(32767, int(v * 32768))) for v in samples])).decode()


def load_clean_16k():
    """真实校准音频 24k → 16k（ffmpeg，与引擎 Kaiser 重采样同级质量）"""
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", CLEAN_WAV,
                          "-ar", "16000", "-ac", "1", "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    n = len(raw) // 2
    return [v / 32768.0 for v in struct.unpack(f"<{n}h", raw)]


def lcg(seed):
    s = seed & 0xFFFFFFFF
    while True:
        s = (s * 1103515245 + 12345) & 0x7FFFFFFF
        yield s / 0x3FFFFFFF - 1


def speech_like(sec, amp=0.4):
    """与 quality.test.ts 同款：音节包络 × f0 微颤（仅用于缺陷注入类用例）"""
    out = []
    for i in range(round(sec * 16000)):
        t = i / 16000
        syl = 0.575 + 0.425 * math.sin(2 * math.pi * 4.5 * t)
        f0 = 220 * (1 + 0.01 * math.sin(2 * math.pi * 0.7 * t))
        out.append(amp * syl * math.sin(2 * math.pi * f0 * t))
    return out


def sine_pcm(freq=440.0, sec=3.0):
    return [12000 / 32768 * math.sin(2 * math.pi * freq * i / 16000) for i in range(int(sec * 16000))]


def sha256(b):
    import hashlib
    return hashlib.sha256(b).hexdigest()


def analyze(pcm, label, notes="v1.3.15 专项回归", source_b64=None):
    body = {"pcmB64": pcm_to_b64(pcm), "sourceType": "UPLOAD",
            "sourceLabel": label, "fileName": f"{label}.bin", "notes": notes}
    if source_b64:
        body["sourceB64"] = source_b64
    code, raw, _ = req("/api/analyze", body)
    try:
        return code, json.loads(raw)
    except Exception:
        return code, {}


# ── 1. 引擎版本口径 + 自检四项 ──────────────────────────────────
print("═══ 1. 引擎 v2.1.0-robust 版本口径 + 自检四项全绿 ═══")
try:
    code, raw, _ = req("/api/selfcheck")
    d = json.loads(raw)
    ver_ok = d.get("engineVersion") == "v2.1.0-robust"
    names = [c["name"] for c in d.get("checks", [])]
    no_synth = not any(("合成" in n or "espeak" in n.lower()) for n in names)
    four_ok = d.get("allOk") is True and d.get("total") == 4
    print(f"  [引擎版本] {'✓' if ver_ok else '✗'} engineVersion={d.get('engineVersion')}（应 v2.1.0-robust）")
    print(f"  [自检四项] {'✓' if four_ok and no_synth else '✗'} {d.get('passed')}/{d.get('total')} 全绿 · {names}")
    (PASS if ver_ok and four_ok and no_synth else FAIL).append("引擎版本+自检口径")
except Exception as e:
    print(f"  ✗ {e}")
    FAIL.append("引擎版本+自检口径")

# ── 2. 质量护栏在场 + 真实音频四项全清 ──────────────────────────
print("═══ 2. analysis.quality 在场 + 真实校准音频四项诊断全清 ═══")
clean_pcm = load_clean_16k()
try:
    code, d = analyze(clean_pcm, "v1315清洁基线")
    an = d.get("analysis", {})
    q = an.get("quality")
    fields_ok = bool(q) and all(k in q for k in ("clippingRatio", "dcOffset", "noiseFloorDb", "peakDb", "warnings"))
    clean_ok = code == 200 and q is not None and q.get("warnings") == []
    print(f"  [quality在场] {'✓' if fields_ok else '✗'} 四项指标+warnings 齐全（HTTP {code}）")
    print(f"  [清洁基线]   {'✓' if clean_ok else '✗'} warnings={q.get('warnings') if q else None}"
          f" · 平顶比 {q.get('clippingRatio', 0) * 100:.4f}% · 底噪 {q.get('noiseFloorDb')}dB · 峰值 {q.get('peakDb')}dB")
    (PASS if fields_ok and clean_ok else FAIL).append("质量护栏在场+清洁全清")
except Exception as e:
    print(f"  ✗ {e}")
    FAIL.append("质量护栏在场+清洁全清")

# ── 3. 直流免疫：判决不变 + 静音闸不击穿 ────────────────────────
print("═══ 3. 直流免疫（+0.05 判决不变 · 静音闸不击穿）═══")
try:
    dc_pcm = [v + 0.05 for v in clean_pcm]
    code2, d2 = analyze(dc_pcm, "v1315直流免疫")
    an2 = d2.get("analysis", {})
    o1, o2 = an.get("overall", {}), an2.get("overall", {})
    risk_ok = code2 == 200 and o1.get("risk") == o2.get("risk") != None
    voiced_ok = an.get("audio", {}).get("voicedWindows") == an2.get("audio", {}).get("voicedWindows")
    drift = abs(o2.get("syntheticRatio", 1) - o1.get("syntheticRatio", 0))
    ratio_ok = drift < 0.02
    q2 = an2.get("quality", {})
    dc_warn_ok = q2.get("warnings") == ["dc-offset"]
    l1 = [w.get("label") for w in an.get("windows", [])]
    l2 = [w.get("label") for w in an2.get("windows", [])]
    drift_n = sum(1 for a, b in zip(l1, l2) if a != b) if len(l1) == len(l2) else -1
    print(f"  [判决不变]   {'✓' if risk_ok and voiced_ok and ratio_ok else '✗'} risk {o1.get('risk')}→{o2.get('risk')}"
          f" · voicedWin {an.get('audio', {}).get('voicedWindows')}→{an2.get('audio', {}).get('voicedWindows')}"
          f" · ratio 漂移 {drift:.5f}（<0.02）")
    print(f"  [窗口标签]   信息性: {drift_n}/{len(l1)} 窗标签微移（档内漂移不阻断）")
    print(f"  [dc 警示]    {'✓' if dc_warn_ok else '✗'} dc 版 warnings={q2.get('warnings')}（应精确 ['dc-offset']）")
    # 静音闸：恒定直流 0.05 × 3s（quality.test.ts：不再击穿静音闸；
    # 0.05 恒值峰值 -26dBFS 亦合法触发 low-level，故断言包含 dc-offset 而非全集）
    code3, d3 = analyze([0.05] * (16000 * 3), "v1315静音闸")
    an3 = d3.get("analysis", {})
    q3 = an3.get("quality", {}).get("warnings", [])
    gate_ok = (code3 == 200 and an3.get("audio", {}).get("voicedWindows") == 0
               and an3.get("overall", {}).get("risk") == "LOW"
               and "dc-offset" in q3)
    print(f"  [静音闸]     {'✓' if gate_ok else '✗'} 恒 0.05 直流 3s → voicedWindows="
          f"{an3.get('audio', {}).get('voicedWindows')} · risk={an3.get('overall', {}).get('risk')} · warnings={q3}（应 0/LOW 且含 dc-offset）")
    (PASS if risk_ok and voiced_ok and ratio_ok and dc_warn_ok and gate_ok else FAIL).append("直流免疫")
except Exception as e:
    print(f"  ✗ {e}")
    FAIL.append("直流免疫")

# ── 4. 质量护栏触发矩阵 ─────────────────────────────────────────
print("═══ 4. 触发矩阵（削波/低电平/噪底 · 判决管道不崩）═══")
try:
    matrix_ok = True
    sp = speech_like(4)
    # 4a 硬削波 ±0.15 → 含 clipping（quality.test.ts toContain 口径）
    xc = [max(-0.15, min(0.15, v)) for v in sp]
    code, d = analyze(xc, "v1315削波")
    w = d.get("analysis", {}).get("quality", {}).get("warnings", [])
    a = code == 200 and "clipping" in w and d.get("analysis", {}).get("overall")
    print(f"  [削波±0.15]  {'✓' if a else '✗'} HTTP {code} · warnings={w}")
    matrix_ok &= bool(a)
    # 4b ×0.05 低电平 → 精确 ["low-level"]，平顶比统计自动关闭
    code, d = analyze([v * 0.05 for v in sp], "v1315低电平")
    q = d.get("analysis", {}).get("quality", {})
    w = q.get("warnings", [])
    b = code == 200 and w == ["low-level"] and q.get("clippingRatio") == 0
    print(f"  [低电平×0.05] {'✓' if b else '✗'} HTTP {code} · warnings={w} · clippingRatio={q.get('clippingRatio')}（应 0）")
    matrix_ok &= bool(b)
    # 4c 真实音频 + 白噪底 0.03（LCG 同款）→ 精确 ["noisy-floor"]
    g = lcg(20261109)
    xn = [v + next(g) * 0.03 * math.sqrt(3) for v in clean_pcm]
    code, d = analyze(xn, "v1315噪底")
    w = d.get("analysis", {}).get("quality", {}).get("warnings", [])
    c = code == 200 and w == ["noisy-floor"]
    print(f"  [噪底0.03]   {'✓' if c else '✗'} HTTP {code} · warnings={w}")
    matrix_ok &= bool(c)
    (PASS if matrix_ok else FAIL).append("质量触发矩阵")
except Exception as e:
    print(f"  ✗ {e}")
    FAIL.append("质量触发矩阵")

# ── 5. 安全响应头（v1.3.14 防回归）─────────────────────────────
print("═══ 5. 安全响应头（v1.3.14 防回归）═══")
try:
    hdr_ok = True
    for path in ("/", "/api/analyze"):
        code, _, hdrs = req(path)
        for k, want in (("x-content-type-options", "nosniff"),
                        ("x-frame-options", "DENY"),
                        ("referrer-policy", "no-referrer")):
            if hdrs.get(k, "") != want:
                hdr_ok = False
                print(f"  [{path} {k}] ✗ 期望 {want} 实得 {hdrs.get(k, '')!r}")
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
    print(f"  [五项头×2路由] {'✓' if hdr_ok else '✗'} nosniff/DENY/no-referrer/permissions(mic only)/CSP 齐全")
    (PASS if hdr_ok else FAIL).append("安全响应头")
except Exception as e:
    print(f"  ✗ {e}")
    FAIL.append("安全响应头")

# ── 6. caseNo 格式闸（v1.3.14 防回归）──────────────────────────
print("═══ 6. caseNo 格式闸（v1.3.14 防回归）═══")
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
        if not (code == 400 and "无效的案件编号" in raw.decode("utf-8", "replace")):
            gate_ok = False
            print(f"  [攻击] {a} → HTTP {code} ✗（期望 400）")
    b1 = req("/api/evidence/SS-20260101-9999")
    b2 = req("/api/cases/SS-20260101-9999")
    b3 = req("/api/verify/SS-20260101-9999")
    b4 = req("/api/evidence-package/SS-20260101-9999")
    try:
        vj = json.loads(b3[1])
        v_ok = b3[0] == 200 and vj.get("verified") is False
    except Exception:
        v_ok = False
    fmt_ok = b1[0] == 404 and b2[0] == 404 and b4[0] == 404 and v_ok
    print(f"  [遍历载荷×{len(attacks)}] {'✓' if gate_ok else '✗'} 全部 400 早退")
    print(f"  [良构不存在] {'✓' if fmt_ok else '✗'} evidence/cases/pkg={[b1[0], b2[0], b4[0]]}"
          f" · verify={b3[0]}+verified=false（语义不被误伤）")
    (PASS if gate_ok and fmt_ok else FAIL).append("caseNo格式闸")
except Exception as e:
    print(f"  ✗ {e}")
    FAIL.append("caseNo格式闸")

# ── 7. 11 维特征剖面（v2.0 防回归）─────────────────────────────
print("═══ 7. 引擎 v2.0 特征剖面（v2.0 防回归）═══")
try:
    code, d = analyze(sine_pcm(), "v1315特征口径")
    prof = d.get("analysis", {}).get("featureProfile", [])
    keys = {p.get("key") for p in prof}
    feat_ok = code == 200 and len(prof) == 11 and {"f0Std", "shimmer", "envMod45"} <= keys
    print(f"  [特征剖面]   {'✓' if feat_ok else '✗'} {len(prof)} 维 · 新键在场: {sorted({'f0Std', 'shimmer', 'envMod45'} & keys)}")
    (PASS if feat_ok else FAIL).append("特征剖面")
except Exception as e:
    print(f"  ✗ {e}")
    FAIL.append("特征剖面")

# ── 8. 并发存证 + 证据核验 + 存证包 ZIP（v1.3.9 防回归）─────────
print("═══ 8. 并发存证 6 路 · 编号唯一 · srcHash 锚定 + 核验 + ZIP ═══")
caseNos = []
try:
    N = 6
    results = [None] * N
    markers = [f"SRC-MARKER-{i}-".encode() + bytes([i]) * 512 for i in range(N)]
    pcms = [sine_pcm(freq=440 + 60 * i) for i in range(N)]

    def worker(i):
        body = {"pcmB64": pcm_to_b64(pcms[i]),
                "sourceB64": base64.b64encode(markers[i]).decode(),
                "sourceType": "UPLOAD", "sourceLabel": f"并发回归·{i}",
                "fileName": f"concurrent-{i}.bin", "notes": "v1.3.15 并发竞态回归"}
        results[i] = req("/api/analyze", body)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
    t0 = time.time()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    elapsed = time.time() - t0
    all_ok = True
    for i, (code, raw, _) in enumerate(results):
        try:
            d = json.loads(raw)
        except Exception:
            d = {}
        if code != 200 or "caseNo" not in d:
            all_ok = False
            print(f"  [并发{i}] ✗ HTTP {code} · {str(raw)[:120]}")
            continue
        caseNos.append(d["caseNo"])
        if d.get("sourceHash") != sha256(markers[i]) or d.get("sourcePreserved") is not True:
            all_ok = False
            print(f"  [并发{i}] ✗ srcHash 不一致/未落盘")
    uniq = len(set(caseNos)) == len(caseNos) == N
    no_leak = all(b"prisma" not in raw.lower() and b"Invalid `" not in raw for _, raw, _ in results)
    print(f"  [并发存证]   {'✓' if all_ok and uniq and no_leak else '✗'} {len(set(caseNos))}/{N} 编号唯一 · srcHash 全锚定 · 无 Prisma 泄漏（{elapsed:.1f}s）")
    conc_ok = all_ok and uniq and no_leak
    (PASS if conc_ok else FAIL).append("并发存证竞态")
except Exception as e:
    print(f"  ✗ {e}")
    conc_ok = False
    FAIL.append("并发存证竞态")

verify_ok = package_ok = False
if caseNos:
    c0 = caseNos[0]
    try:
        code, raw, _ = req(f"/api/verify/{c0}")
        d = json.loads(raw)
        src_check = next((c for c in d.get("checks", []) if "原始来源" in c["name"]), None)
        verify_ok = d.get("verified") is True and src_check and src_check["status"] == "ok"
        print(f"  [证据核验]   {'✓' if verify_ok else '✗'} verified={d.get('verified')} · 原始来源={src_check['status'] if src_check else '缺失'}")
    except Exception as e:
        print(f"  [证据核验]   ✗ {e}")
    try:
        code, raw, hdrs = req(f"/api/evidence-package/{c0}")
        is_zip = hdrs.get("content-type", "").startswith("application/zip") and raw[:2] == b"PK"
        zf = zipfile.ZipFile(io.BytesIO(raw))
        names = zf.namelist()
        need = ["case-record.json", "integrity-report.json", "SHA256SUMS.txt", "README.txt",
                f"{c0}_evidence.wav", f"{c0}_source.bin"]
        sums_ok = all(sha256(zf.read(n)) == h
                      for h, n in (line.split("  ", 1) for line in zf.read("SHA256SUMS.txt").decode().splitlines()))
        rec = json.loads(zf.read("case-record.json"))
        rec_ok = rec.get("audioHash") == sha256(zf.read(f"{c0}_evidence.wav"))
        package_ok = code == 200 and is_zip and all(n in names for n in need) and sums_ok and rec_ok
        print(f"  [存证包ZIP]  {'✓' if package_ok else '✗'} HTTP {code} · {len(raw)}B · 成员{len(names)} · 清单自洽={sums_ok}")
    except Exception as e:
        print(f"  [存证包ZIP]  ✗ {e}")
(PASS if verify_ok else FAIL).append("证据核验·含原始来源") if caseNos else FAIL.append("证据核验·含原始来源")
(PASS if package_ok else FAIL).append("存证包ZIP") if caseNos else FAIL.append("存证包ZIP")

# ── 9. 请求体早期上限（v1.3.9 防回归）──────────────────────────
print("═══ 9. 请求体早期上限（>16MiB → 413）═══")
try:
    s = socket.create_connection(("127.0.0.1", 3000), timeout=20)
    total = 17 * 1024 * 1024
    head = (f"POST /api/analyze HTTP/1.1\r\nHost: 127.0.0.1:3000\r\n"
            f"Content-Type: application/json\r\nContent-Length: {total}\r\n\r\n").encode()
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
    print(f"  [体积闸]     {'✓' if gate_ok else '✗'} 响应: {status_line}")
    (PASS if gate_ok else FAIL).append("请求体早期上限")
except Exception as e:
    print(f"  [体积闸]     ✗ {e}")
    FAIL.append("请求体早期上限")

# ── 汇总 ──────────────────────────────────────────────────────
print()
print(f"═══ v1.3.15 专项回归：{len(PASS)} 通过 / {len(FAIL)} 失败 ═══")
for f in FAIL:
    print(f"  ✗ {f}")
sys.exit(1 if FAIL else 0)
