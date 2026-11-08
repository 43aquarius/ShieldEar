#!/usr/bin/env python3
"""v1.3.10 排障:验证 espeak-ng 变体音色真实区分 + 基频分析"""
import subprocess, hashlib, wave, struct, os, sys, json

TEXT = "声盾提醒您,这是一段语音合成安全测试,请勿向陌生人转账汇款。"
OUT = "/tmp/tts-probe"
os.makedirs(OUT, exist_ok=True)

variants = {
    "tongtong": ("cmn+f2", 160),   # 桐桐·温暖亲切
    "chuichui": ("cmn+f5", 175),   # 吹吹·活泼可爱(语速稍快)
    "xiaochen": ("cmn+m3", 145),   # 小陈·沉稳专业
    "jam":      ("cmn+m1", 150),   # Jam
    "kazi":     ("cmn+m5", 160),   # 卡兹·清晰标准
    "douji":    ("cmn+f4", 155),   # 豆几
    "luodo":    ("cmn+m6", 140),   # 罗多·富有感染力(低沉)
    "_baseline_cmn": ("cmn", 160), # 基线:现行硬编码
}

def f0_of_wav(path):
    """简单自相关法估平均基频(女声~200Hz 男声~120Hz)"""
    with wave.open(path) as w:
        sr = w.getframerate()
        n = w.getnframes()
        pcm = struct.unpack(f"<{n}h", w.readframes(n))
    # 抽取有能量的帧做自相关
    win, hop = int(sr*0.04), int(sr*0.02)
    f0s = []
    for i in range(0, len(pcm)-win, hop):
        seg = pcm[i:i+win]
        if max(abs(x) for x in seg) < 300:
            continue
        best_l, best_r = 0, 0
        for lag in range(int(sr/400), int(sr/70)):  # 70-400Hz
            r = sum(seg[j]*seg[j+lag] for j in range(win-lag))
            if r > best_r:
                best_r, best_l = r, lag
        if best_l:
            f0s.append(sr/best_l)
    return sum(f0s)/len(f0s) if f0s else 0

results = {}
for name, (v, wpm) in variants.items():
    out = f"{OUT}/{name}.wav"
    r = subprocess.run(
        ["espeak-ng", "-v", v, "-s", str(wpm), "-w", out, TEXT],
        capture_output=True, timeout=30,
    )
    if r.returncode != 0:
        print(f"{name}: FAIL {r.stderr.decode()[:100]}")
        continue
    data = open(out, "rb").read()
    with wave.open(out) as w:
        sr, dur = w.getframerate(), w.getnframes()/w.getframerate()
    results[name] = {
        "variant": v, "sha256_12": hashlib.sha256(data).hexdigest()[:12],
        "sr": sr, "dur_s": round(dur, 2), "f0_hz": round(f0_of_wav(out), 1),
    }

for k, v in results.items():
    print(f"{k:14s} {v['variant']:10s} sha={v['sha256_12']} sr={v['sr']} dur={v['dur_s']}s f0={v['f0_hz']}Hz")

# 唯一性检查
shas = {v["sha256_12"] for v in results.values()}
print(f"\n唯一 WAV 数: {len(shas)} / {len(results)}  ({'全部互异' if len(shas)==len(results) else '存在重复!'})")

# 7 个正式音色 f0 分布
f0s = [results[k]["f0_hz"] for k in variants if k != "_baseline_cmn"]
print(f"正式 7 音色 f0 范围: {min(f0s):.0f} – {max(f0s):.0f} Hz (可区分度 {'OK' if max(f0s)-min(f0s)>40 else '不足'})")
