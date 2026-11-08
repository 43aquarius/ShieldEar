#!/usr/bin/env python3
"""regress-v1310.py — v1.3.10 专项回归（在断网 netns 内对交付包运行）

覆盖本轮两缺陷的修复验证 + v1.3.9 既有四项（防回归）：
  1. 七音色真实互异（v1.3.10 bug 1：音色丢弃）：
     7 音色全部 live/espeak；sourceHash 两两互异；engineLabel 含各自
     预期变体（cmn+f2…cmn+m6 精确匹配）；返回 PCM 基频女声组(3)显著
     高于男声组(4)；时长正常（非乱码碎片）
  2. selfcheck 第 4 项「发行包内组件」+ 单音色 live 合成（v1.3.9 根因）
  3. 并发存证竞态：6 并发，编号唯一、证据零交叉污染（v1.3.9）
  4. 存证包 ZIP：结构、SHA256SUMS 自洽、记录锚定（v1.3.9）
  5. 请求体早期上限：>16MiB → 413（v1.3.9）
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

EXPECT_VARIANT = {
    "tongtong": "cmn+f2", "chuichui": "cmn+f5", "xiaochen": "cmn+m3",
    "jam": "cmn+m1", "kazi": "cmn+m5", "douji": "cmn+f4", "luodo": "cmn+m6",
}
FEMALE = ("tongtong", "chuichui", "douji")
MALE = ("xiaochen", "jam", "kazi", "luodo")


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


def f0_median(pcm, sr=16000):
    win, hop = int(sr * 0.04), int(sr * 0.02)
    f0s = []
    for i in range(0, len(pcm) - win, hop):
        seg = pcm[i:i + win]
        if max(abs(x) for x in seg) < 300:
            continue
        best_l, best_r = 0, 0
        for lag in range(int(sr / 400), int(sr / 70)):
            r = sum(seg[j] * seg[j + lag] for j in range(win - lag))
            if r > best_r:
                best_r, best_l = r, lag
        if best_l:
            f0s.append(sr / best_l)
    f0s.sort()
    return f0s[len(f0s) // 2] if f0s else 0.0


# ── 1. 七音色真实互异（v1.3.10 bug 1+2 修复验证）──────────────────
print("═══ 1. 七音色真实互异（变体 · 哈希 · 基频分组 · 朗读时长）═══")
voice_rows = {}
v_fails = []
for v, expect in EXPECT_VARIANT.items():
    try:
        code, raw, _ = req("/api/tts-challenge", {
            "text": "喂您好，我是您的专属客服，您有一笔退款需要处理，请按提示操作。",
            "voice": v, "speed": 1.0})
        d = json.loads(raw)
        label = d.get("engineLabel", "")
        variant = label.split("·")[-1].strip() if "·" in label else "?"
        pcm = struct.unpack(f"<{len(base64.b64decode(d['audio']['pcmB64'])) // 2}h",
                            base64.b64decode(d["audio"]["pcmB64"]))
        f0 = f0_median(list(pcm))
        dur = d["audio"]["durationSec"]
        voice_rows[v] = dict(code=code, mode=d.get("mode"), engine=d.get("engine"),
                             variant=variant, sha=d.get("sourceHash", "")[:12], dur=dur, f0=f0)
        print(f"  [{v:9s}] {'✓' if code == 200 else '✗'} {d.get('mode')}/{d.get('engine')} · "
              f"{variant}(期望 {expect}) · sha={d.get('sourceHash', '')[:12]} · {dur:.2f}s · {f0:.0f}Hz")
    except Exception as e:
        print(f"  [{v:9s}] ✗ {e}")
        v_fails.append(f"{v}: 异常 {e}")

if len(voice_rows) == 7:
    live_ok = all(r["mode"] == "live" and r["engine"] == "espeak" for r in voice_rows.values())
    var_ok = all(voice_rows[v]["variant"] == e for v, e in EXPECT_VARIANT.items())
    n_sha = len({r["sha"] for r in voice_rows.values()})
    sha_ok = n_sha == 7
    dur_ok = all(4 < r["dur"] < 16 for r in voice_rows.values())
    f_min = min(voice_rows[v]["f0"] for v in FEMALE)
    m_max = max(voice_rows[v]["f0"] for v in MALE)
    grp_ok = f_min > m_max
    print(f"  [live/espeak]  {'✓' if live_ok else '✗'} 全部走本地 espeak（非回放）")
    print(f"  [变体精确匹配] {'✓' if var_ok else '✗'} 7/7 与 ESPEAK_VOICE_MAP 一致")
    print(f"  [哈希互异]     {'✓' if sha_ok else '✗'} {n_sha}/7")
    print(f"  [朗读时长]     {'✓' if dur_ok else '✗'} 全部 4–16s（非乱码碎片）")
    print(f"  [基频分组]     {'✓' if grp_ok else '✗'} 女声组最低 {f_min:.0f}Hz > 男声组最高 {m_max:.0f}Hz")
    if all((live_ok, var_ok, sha_ok, dur_ok, grp_ok)) and not v_fails:
        PASS.append("七音色真实互异")
    else:
        FAIL.append("七音色真实互异")
else:
    print(f"  ✗ 仅 {len(voice_rows)}/7 音色成功")
    FAIL.append("七音色真实互异")

# ── 2. selfcheck + 单音色（v1.3.9 根因修复，防回归）────────────────
print("═══ 2. 自检·发行包内组件 + live 合成（v1.3.9 防回归）═══")
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

# ── 3. 并发存证竞态（v1.3.9 防回归）────────────────────────────────
print("═══ 3. 并发存证竞态（6 并发 · 编号唯一 · 证据零污染）═══")
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
        "notes": "v1.3.10 并发竞态回归",
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

# ── 4. 证据核验 + 存证包 ZIP（v1.3.9 防回归）──────────────────────
print("═══ 4. 证据核验与存证包 ZIP ═══")
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

# ── 5. 请求体早期上限（v1.3.9 防回归）─────────────────────────────
print("═══ 5. 请求体早期上限（>16MiB → 413，不进解码）═══")
try:
    import socket
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
print(f"═══ v1.3.10 专项回归：{len(PASS)} 通过 / {len(FAIL)} 失败 ═══")
for f in FAIL:
    print(f"  ✗ {f}")
sys.exit(1 if FAIL else 0)
