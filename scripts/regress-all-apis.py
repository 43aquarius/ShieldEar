#!/usr/bin/env python3
"""regress-all-apis.py — 全功能回归（v1.3.11 口径）
（实时鉴听/文件检测/案例库/存证包/离线声明/系统自检/证据完整性核验）

v1.3.11 变更：合成挑战已随功能移除 —— LIVE/UPLOAD 用例的输入改为
读取包内预置样本（16kHz WAV 直读；24kHz 样本纯 Python 多相重采样），
不再依赖 TTS 产物；「云端通道」项改为验证旧合成路由已下线（404）
且自检声明纯离线。
"""
import base64
import json
import struct
import sys
import urllib.error
import urllib.request
import wave

BASE = "http://localhost:3000"
PASS, FAIL = [], []

# 样本定位：断网包测时用解压树内样本，开发机用仓库样本
import os
_CANDIDATES = [
    "/tmp/zip-verify/ShieldEar/server/public/samples/demo_natural_demo.wav",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "samples", "demo_natural_demo.wav"),
    "public/samples/demo_natural_demo.wav",
]
SAMPLE = next((p for p in _CANDIDATES if os.path.exists(p)), None)


def load_pcm16k_b64(path, max_sec=8.0):
    """读 WAV → 单声道 int16 PCM → 16kHz（如需则线性插值降采样）→ base64。

    回归用途（验证 API 管线），线性插值足够；与浏览器/种子管线的
    抗混叠重采样差异不影响接口层断言。
    """
    with wave.open(path, "rb") as w:
        rate = w.getframerate()
        nch = w.getnchannels()
        sw = w.getsampwidth()
        assert sw == 2, f"非 16bit: {path}"
        n = min(w.getnframes(), int(max_sec * rate))
        raw = w.readframes(n)
    pcm = struct.unpack(f"<{len(raw) // 2}h", raw)
    if nch > 1:
        pcm = pcm[::nch]
    if rate != 16000:
        out_n = int(len(pcm) * 16000 / rate)
        pcm = tuple(
            int(pcm[min(int(i * rate / 16000), len(pcm) - 1)] +
                (pcm[min(int(i * rate / 16000) + 1, len(pcm) - 1)] -
                 pcm[min(int(i * rate / 16000), len(pcm) - 1)]) *
                ((i * rate / 16000) % 1.0))
            for i in range(out_n)
        )
    return base64.b64encode(struct.pack(f"<{len(pcm)}h", *pcm)).decode()


def post(path, body, timeout=120):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def get(path, timeout=60):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return r.status, r.read()


_latest_case = "SS-00000000-0000"

# ── 1. 检测输入源（包内真人样本） ──
if not SAMPLE:
    print("[检测输入]   ✗ 找不到预置样本（候选路径均不存在）")
    FAIL.append("检测输入")
    sys.exit(1)
try:
    pcm_b64 = load_pcm16k_b64(SAMPLE)
    print(f"[检测输入]   ✓ {os.path.basename(SAMPLE)} → {len(base64.b64decode(pcm_b64)) // 2 :,} 样本（16kHz）")
    PASS.append("检测输入")
except Exception as e:
    print(f"[检测输入]   ✗ {e}")
    FAIL.append("检测输入")
    sys.exit(1)

# ── 2. 实时鉴听（LIVE）与 3. 文件检测（UPLOAD） ──
for name, st in [("实时鉴听", "LIVE"), ("文件检测", "UPLOAD")]:
    try:
        code, d = post("/api/analyze", {
            "pcmB64": pcm_b64, "sourceType": st,
            "sourceLabel": f"回归测试·{name}",
            "fileName": "regression.wav" if st == "UPLOAD" else None,
            "notes": "v1.3.11 全功能回归"})
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

# ── 6. 合成通道下线声明（v1.3.11：旧合成/云端路由必须 404） ──
try:
    code, d = post("/api/tts-challenge", {"text": "下线验证", "voice": "tongtong"}, timeout=15)
    assert code == 404, f"合成路由应已下线(404)，实际 HTTP {code}"
    code2, _ = post("/api/config/cloud", {"enabled": True}, timeout=15)
    assert code2 == 404, f"云端配置路由应已下线(404)，实际 HTTP {code2}"
    print(f"[合成通道下线] HTTP {code}/{code2} 404 ✓ · 合成与云端路由均已移除（零联网面）")
    PASS.append("合成通道下线")
except Exception as e:
    print(f"[合成通道下线] ✗ {e}"); FAIL.append("合成通道下线")

# ── 7. 系统自检：四项全部通过且声明纯离线 ──
try:
    code, raw = get("/api/selfcheck", timeout=60)
    d = json.loads(raw)
    assert d["allOk"] is True, f"自检存在失败项: {[c['name'] for c in d['checks'] if not c['ok']]}"
    assert d["releaseOffline"] is True, "发行包应声明纯离线"
    print(f"[系统自检]   HTTP {code} · {d['passed']}/{d['total']} 全绿 · "
          f"engine={d['engineVersion']} · releaseOffline={d['releaseOffline']}")
    PASS.append("系统自检")
except Exception as e:
    print(f"[系统自检]   ✗ {e}"); FAIL.append("系统自检")

# ── 8. 证据完整性核验：最新案例必须核验通过 ──
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
