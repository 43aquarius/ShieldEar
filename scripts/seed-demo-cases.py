#!/usr/bin/env python3
"""seed-demo-cases.py — 为演示便携包灌入代表性案例库数据
4 条案例：2 真人（低危）+ 2 AI 伪造（高危），标签面向答辩演示。
用法: python3 scripts/seed-demo-cases.py  (需 dev server 运行在 :3000)
"""
import wave, base64, json, sys, urllib.request

BASE = "http://localhost:3000"

def load_pcm16k(path):
    w = wave.open(path)
    rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
    assert width == 2 and ch == 1, f"{path}: 非单声道16bit"
    frames = w.readframes(w.getnframes())
    w.close()
    if rate == 16000:
        return frames
    # 线性插值重采样到 16k
    import struct
    samples = struct.unpack(f"<{len(frames)//2}h", frames)
    n_out = int(len(samples) * 16000 / rate)
    out = []
    for i in range(n_out):
        pos = i * rate / 16000
        i0 = int(pos)
        frac = pos - i0
        i1 = min(i0 + 1, len(samples) - 1)
        out.append(int(samples[i0] * (1 - frac) + samples[i1] * frac))
    return struct.pack(f"<{len(out)}h", *out)

def post(path, body, timeout=120):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read())

JOBS = [
    ("public/samples/demo_natural_demo.wav", "演示 · 真人客服录音", "demo_real_customer_service.wav"),
    ("public/samples/demo_natural_viper.wav", "演示 · 真人声纹样本", "demo_real_voiceprint.wav"),
    ("public/samples/demo_scam_tongtong.wav", "演示 · AI克隆『彤彤』诈骗来电", "demo_ai_clone_tongtong.wav"),
    ("public/samples/demo_scam_luodo.wav", "演示 · AI合成『落多』话术", "demo_ai_synth_luodo.wav"),
]

ok = fail = 0
for path, label, fname in JOBS:
    try:
        pcm = load_pcm16k(path)
        b64 = base64.b64encode(pcm).decode()
        code, d = post("/api/analyze", {
            "pcmB64": b64, "sourceType": "UPLOAD",
            "sourceLabel": label, "fileName": fname,
            "notes": "v1.3.4 演示案例 · 断网便携包内置",
        })
        o = d["analysis"]["overall"]
        print(f"✓ {label} · caseNo={d.get('caseNo')} · risk={o.get('risk')} · "
              f"synthetic={o.get('syntheticRatio')} · verdict={o.get('verdict')}")
        ok += 1
    except Exception as e:
        print(f"✗ {label}: {e}")
        fail += 1

print(f"\n完成: {ok} 成功 / {fail} 失败")
sys.exit(1 if fail else 0)
