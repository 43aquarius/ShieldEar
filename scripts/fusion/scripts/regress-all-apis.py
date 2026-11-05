#!/usr/bin/env python3
"""regress-all-apis.py — v1.3.3 融合版全功能回归
（合成挑战/实时鉴听/文件检测/案例库/存证包/云端通道开关）"""
import json, base64, urllib.request, urllib.error, sys

BASE = "http://localhost:3000"
PASS, FAIL = [], []

def post(path, body, timeout=120):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read())

def get(path, timeout=60):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return r.status, r.read()

# ── 1. 合成挑战（四级链） ──
try:
    code, d = post("/api/tts-challenge", {
        "text": "您好，我是您的孙子，我遇到车祸急需三万元医药费，请马上转账到这个账户。",
        "voice": "tongtong", "speed": 1.0})
    overall = d["analysis"]["overall"]
    print(f"[合成挑战]   HTTP {code} · engine={d['engine']}({d['engineLabel']}) mode={d['mode']} · "
          f"caseNo={d['caseNo']} · risk={overall['risk']} · 合成置信度={overall['syntheticRatio']*100:.1f}% · "
          f"时长={d['audio']['durationSec']}s")
    PASS.append("合成挑战")
    pcm_b64 = d["audio"]["pcmB64"]
except Exception as e:
    print(f"[合成挑战]   ✗ {e}"); FAIL.append("合成挑战"); sys.exit(1)

# ── 2. 实时鉴听（LIVE）与 3. 文件检测（UPLOAD） ──
for name, st in [("实时鉴听", "LIVE"), ("文件检测", "UPLOAD")]:
    try:
        code, d = post("/api/analyze", {
            "pcmB64": pcm_b64, "sourceType": st,
            "sourceLabel": f"回归测试·{name}",
            "fileName": "regression.wav" if st == "UPLOAD" else None,
            "notes": "v1.3.3 融合版全功能回归"})
        o = d["analysis"]["overall"]
        print(f"[{name}]   HTTP {code} · caseNo={d['caseNo']} · risk={o['risk']} · verdict={o['verdict']}")
        PASS.append(name)
    except Exception as e:
        print(f"[{name}]   ✗ {e}"); FAIL.append(name)

# ── 4. 案例库 ──
try:
    code, raw = get("/api/cases?limit=5")
    d = json.loads(raw)
    cases = d.get("cases") or d.get("items") or []
    print(f"[案例库]     HTTP {code} · {len(cases)} 条 · 最新: {cases[0]['caseNo'] if cases else '-'}")
    PASS.append("案例库")
except Exception as e:
    print(f"[案例库]     ✗ {e}"); FAIL.append("案例库")

# ── 5. 存证包 ──
try:
    code, raw = get("/api/evidence/SS-20261029-0001", timeout=60)
    magic = raw[:4]
    print(f"[存证包]     HTTP {code} · {len(raw)}B · magic={magic} ({'WAV✓' if magic==b'RIFF' else '非WAV✗'})")
    (PASS if magic == b"RIFF" else FAIL).append("存证包")
except Exception as e:
    print(f"[存证包]     ✗ {e}"); FAIL.append("存证包")

# ── 6. 云端通道开关（v1.3.2）：关闭→合成必走 espeak→恢复 ──
try:
    code, d = post("/api/config/cloud", {"enabled": False}, timeout=15)
    assert d["cloudEnabled"] is False, "关闭失败"
    import time as _t
    t0 = _t.time()
    code2, d2 = post("/api/tts-challenge", {
        "text": "离线验证：云端通道关闭后，合成应直达本地espeak，零联网零等待。",
        "voice": "tongtong", "speed": 1.0}, timeout=60)
    dt = _t.time() - t0
    assert d2["engine"] == "espeak" and d2.get("cloudEnabled") is False, \
        f"离线合成应走espeak，实际={d2['engine']}"
    print(f"[云端开关·离] HTTP {code2} · engine={d2['engine']}({d2['engineLabel']}) · 耗时={dt:.2f}s · 零联网零等待")
    code3, d3 = post("/api/config/cloud", {"reset": True}, timeout=15)
    # reset 恢复的是环境默认值：离线模式(SHIELDEAR_OFFLINE=1)默认关闭，联网环境默认开启
    expect = not d3["offlineMode"]
    assert d3["cloudEnabled"] is expect, f"恢复默认失败: 期望 {expect}, 实际 {d3['cloudEnabled']}"
    print(f"[云端开关·复位] HTTP {code3} · cloudEnabled={d3['cloudEnabled']} · offlineMode={d3['offlineMode']}（恢复环境默认值）")
    PASS.append("云端通道开关")
except Exception as e:
    print(f"[云端开关]   ✗ {e}"); FAIL.append("云端通道开关")

print(f"\n结果: {len(PASS)} 通过 / {len(FAIL)} 失败 {('· 失败项: ' + ', '.join(FAIL)) if FAIL else '✓ 全绿'}")
sys.exit(1 if FAIL else 0)
