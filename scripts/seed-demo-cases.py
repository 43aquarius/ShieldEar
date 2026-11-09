#!/usr/bin/env python3
"""seed-demo-cases.py — 为演示便携包灌入代表性案例库数据（v1.3.11）
4 条案例：2 真人（低危）+ 2 神经合成（高危），全部经 /api/analyze 的
正式管线入库（服务端复核 + 先插库后写盘 + 原始来源随证落盘），
标签面向答辩演示。

v1.3.11 变更：随合成挑战功能整体移除，不再灌入本地引擎现场合成案例
（案例类型仅剩 LIVE/UPLOAD）。

v1.3.9 变更（历史口径）：
  · 客户端侧重采样改用 scipy resample_poly（与新版浏览器管线等质量）；
  · 上传案例附带 sourceB64（原始 WAV 字节随行），使核验页「原始来源
    文件」检查在出厂库上即为 ok。

用法: python3 scripts/seed-demo-cases.py  (需 server 运行在 :3000)
"""
import base64
import json
import sys
import urllib.request

import numpy as np
import scipy.io.wavfile as wavfile
from scipy.signal import resample_poly
from math import gcd


def load_pcm16k_b64(path):
    rate, data = wavfile.read(path)
    assert data.dtype == np.int16, f"{path}: 非 16bit"
    if data.ndim == 2:
        data = data.mean(axis=1).astype(np.int16)
    if rate != 16000:
        g = gcd(rate, 16000)
        out = resample_poly(data.astype(np.float64) / 32768.0, 16000 // g, rate // g, window=("kaiser", 9.0))
        data = np.clip(np.round(out * 32768.0), -32768, 32767).astype(np.int16)
    return base64.b64encode(data.tobytes()).decode()


def file_b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def post(path, body, timeout=120):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read())


UPLOAD_JOBS = [
    ("public/samples/demo_natural_demo.wav", "演示 · 真人客服录音", "demo_real_customer_service.wav"),
    ("public/samples/demo_natural_viper.wav", "演示 · 真人声纹样本", "demo_real_voiceprint.wav"),
    ("public/samples/demo_scam_tongtong.wav", "演示 · AI克隆『彤彤』诈骗来电", "demo_ai_clone_tongtong.wav"),
    ("public/samples/demo_scam_luodo.wav", "演示 · AI合成『落多』话术", "demo_ai_synth_luodo.wav"),
]

BASE = "http://localhost:3000"

ok = fail = 0
for path, label, fname in UPLOAD_JOBS:
    try:
        code, d = post("/api/analyze", {
            "pcmB64": load_pcm16k_b64(path),
            "sourceB64": file_b64(path),
            "sourceType": "UPLOAD",
            "sourceLabel": label,
            "fileName": fname,
            "notes": "v1.3.10 演示案例 · 断网便携包内置（含原始来源随证）",
        })
        o = d["analysis"]["overall"]
        print(f"✓ {label} · caseNo={d.get('caseNo')} · risk={o.get('risk')} · "
              f"synthetic={o.get('syntheticRatio')} · verdict={o.get('verdict')} · srcPreserved={d.get('sourcePreserved')}")
        ok += 1
    except Exception as e:
        print(f"✗ {label}: {e}")
        fail += 1

# 本地引擎现场合成案例已于 v1.3.11 随合成挑战功能移除

print(f"\n种子完成：{ok} 成功 / {fail} 失败")
sys.exit(1 if fail else 0)
