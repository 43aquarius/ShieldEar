#!/usr/bin/env python3
"""regress-all-apis.py — v1.3.5 全功能回归
（合成挑战/实时鉴听/文件检测/案例库/存证包/云端通道/系统自检/证据完整性核验）"""
import json, base64, urllib.request, urllib.error, sys, time as _t

BASE = "http://localhost:3000"
_latest_case = "SS-20261027-0001"  # 案例库读取后动态更新
PASS, FAIL = [], []


def post(path, body, timeout=120):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        # 4xx/5xx 也是有效响应体（发行锁 403 等）
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}

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
            "notes": "v1.3.5 全功能回归"})
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
    _latest_case = cases[0]["caseNo"] if cases else ""
    print(f"[案例库]     HTTP {code} · {len(cases)} 条 · 最新: {_latest_case or '-'}")
    PASS.append("案例库")
except Exception as e:
    print(f"[案例库]     ✗ {e}"); FAIL.append("案例库")

# ── 5. 存证包（动态取最新案号，避免硬编码失效） ──
try:
    code, raw = get("/api/evidence/" + _latest_case, timeout=60)
    magic = raw[:4]
    print(f"[存证包]     HTTP {code} · {len(raw)}B · magic={magic} ({'WAV✓' if magic==b'RIFF' else '非WAV✗'})")
    (PASS if magic == b"RIFF" else FAIL).append("存证包")
except Exception as e:
    print(f"[存证包]     ✗ {e}"); FAIL.append("存证包")

# ── 6. 云端通道：发行锁(403)或运行时开关（v1.3.5 自适应） ──
try:
    code, d = post("/api/config/cloud", {"enabled": True}, timeout=15)
    if code == 403:
        # 纯离线发行版：切换必须被拒绝，且状态恒为关闭
        assert d.get("releaseOffline") is True and d.get("cloudEnabled") is False, "发行锁响应异常"
        t0 = _t.time()
        code2, d2 = post("/api/tts-challenge", {
            "text": "发行锁验证：纯离线发行版合成必走本地espeak，零联网。",
            "voice": "tongtong", "speed": 1.0}, timeout=60)
        dt = _t.time() - t0
        assert d2["engine"] == "espeak" and d2.get("cloudEnabled") is False, \
            f"发行锁下合成应走espeak，实际={d2['engine']}"
        print(f"[云端通道·锁] HTTP {code} 403 ✓ · engine={d2['engine']}({d2['engineLabel']}) · 耗时={dt:.2f}s · 零联网零等待")
    else:
        # 开发版：运行时开关可用，开→关→复位验证
        assert d["cloudEnabled"] is True, "开启失败"
        code2, d2 = post("/api/config/cloud", {"enabled": False}, timeout=15)
        assert d2["cloudEnabled"] is False, "关闭失败"
        t0 = _t.time()
        code3, d3 = post("/api/tts-challenge", {
            "text": "离线验证：云端通道关闭后，合成应直达本地espeak，零联网零等待。",
            "voice": "tongtong", "speed": 1.0}, timeout=60)
        dt = _t.time() - t0
        assert d3["engine"] == "espeak" and d3.get("cloudEnabled") is False, \
            f"离线合成应走espeak，实际={d3['engine']}"
        print(f"[云端开关·离] HTTP {code3} · engine={d3['engine']}({d3['engineLabel']}) · 耗时={dt:.2f}s · 零联网零等待")
        code4, d4 = post("/api/config/cloud", {"reset": True}, timeout=15)
        expect = not d4["offlineMode"]
        assert d4["cloudEnabled"] is expect, f"恢复默认失败: 期望 {expect}, 实际 {d4['cloudEnabled']}"
        print(f"[云端开关·复位] HTTP {code4} · cloudEnabled={d4['cloudEnabled']} · offlineMode={d4['offlineMode']}（恢复环境默认值）")
    PASS.append("云端通道")
except Exception as e:
    print(f"[云端通道]   ✗ {e}"); FAIL.append("云端通道")

# ── 7. 系统自检（v1.3.5）：全部子系统必须通过 ──
try:
    code, raw = get("/api/selfcheck", timeout=60)
    d = json.loads(raw)
    assert d["allOk"] is True, f"自检存在失败项: {[c['name'] for c in d['checks'] if not c['ok']]}"
    print(f"[系统自检]   HTTP {code} · {d['passed']}/{d['total']} 全绿 · "
          f"engine={d['engineVersion']} · releaseOffline={d['releaseOffline']}")
    PASS.append("系统自检")
except Exception as e:
    print(f"[系统自检]   ✗ {e}"); FAIL.append("系统自检")

# ── 8. 证据完整性核验（v1.3.5）：最新案例必须核验通过 ──
try:
    code, raw = get("/api/verify/" + _latest_case, timeout=60)
    d = json.loads(raw)
    assert d["verified"] is True, f"核验未通过: {[c for c in d['checks'] if c['status']=='fail']}"
    print(f"[证据核验]   HTTP {code} · {_latest_case} · verified=True · "
          f"SHA-256 重算一致 · {d['durationMs']}ms")
    PASS.append("证据核验")
except Exception as e:
    print(f"[证据核验]   ✗ {e}"); FAIL.append("证据核验")

print(f"\n结果: {len(PASS)} 通过 / {len(FAIL)} 失败 {('· 失败项: ' + ', '.join(FAIL)) if FAIL else '✓ 全绿'}")
sys.exit(1 if FAIL else 0)
