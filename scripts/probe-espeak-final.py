#!/usr/bin/env python3
"""v1.3.10 最终音色表验证:variant + pitch(-p) + speed(-s) 三维区分度"""
import subprocess, hashlib, wave, struct, os, json

TEXT = "喂,您好,我是您的专属客服,您有一笔退款需要处理,请按提示操作。"
OUT = "/tmp/tts-final"
os.makedirs(OUT, exist_ok=True)

# 7 音色最终参数表: (espeak variant, pitch -p, base_wpm)
FINAL = {
    "tongtong":  ("cmn+f2", 55, 160),  # 桐桐·温暖亲切(女)
    "chuichui":  ("cmn+f5", 78, 180),  # 吹吹·活泼可爱(少女,语速快)
    "xiaochen":  ("cmn+m3", 38, 140),  # 小陈·沉稳专业(低缓男声)
    "jam":       ("cmn+m1", 58, 150),  # Jam·明亮男声
    "kazi":      ("cmn+m5", 68, 165),  # 卡兹·清晰标准(高音男声,干脆)
    "douji":     ("cmn+f4", 60, 150),  # 豆几·自然流畅(女中音)
    "luodo":     ("cmn+m6", 30, 135),  # 罗多·富有感染力(低沉浑厚)
}

def analyze(path):
    with wave.open(path) as w:
        sr, n = w.getframerate(), w.getnframes()
        pcm = struct.unpack(f"<{n}h", w.readframes(n))
    win, hop = int(sr*0.04), int(sr*0.02)
    f0s, rms_sq = [], []
    for i in range(0, len(pcm)-win, hop):
        seg = pcm[i:i+win]
        rms = (sum(x*x for x in seg)/win) ** 0.5
        rms_sq.append(rms)
        if rms < 200: continue
        best_l, best_r = 0, 0
        for lag in range(int(sr/400), int(sr/70)):
            r = sum(seg[j]*seg[j+lag] for j in range(win-lag))
            if r > best_r: best_r, best_l = r, lag
        if best_l: f0s.append(sr/best_l)
    f0s.sort()
    f0 = f0s[len(f0s)//2] if f0s else 0  # 中位数更稳
    return sr, n/sr, f0, (sum(rms_sq)/len(rms_sq))

rows = []
for name, (v, p, wpm) in FINAL.items():
    out = f"{OUT}/{name}.wav"
    # stdin + -b 1 方案(与线上改造后一致)
    r = subprocess.run(
        ["espeak-ng", "-v", v, "-b", "1", "-p", str(p), "-s", str(wpm), "-w", out],
        input=TEXT.encode("utf-8"), capture_output=True, timeout=30,
    )
    assert r.returncode == 0, f"{name}: {r.stderr}"
    sr, dur, f0, rms = analyze(out)
    sha = hashlib.sha256(open(out, "rb").read()).hexdigest()[:10]
    rows.append((name, v, p, wpm, sha, dur, f0, rms))

print(f"{'音色':10s} {'variant':9s} {'pitch':5s} {'wpm':4s} {'sha':10s} {'dur':6s} {'f0中位':8s} {'rms':6s}")
for r in rows:
    print(f"{r[0]:10s} {r[1]:9s} {r[2]:<5d} {r[3]:<4d} {r[4]:10s} {r[5]:5.2f}s {r[6]:7.1f}Hz {r[7]:5.0f}")

f0s = [r[6] for r in rows]
print(f"\nf0 覆盖: {min(f0s):.0f}–{max(f0s):.0f} Hz")
shas = {r[4] for r in rows}
print(f"WAV 唯一: {len(shas)}/7")
# 男声组内部区分
males = [r for r in rows if "+m" in r[1]]
mf0 = [r[6] for r in males]
print(f"男声组 f0: {', '.join(f'{r[0]}={r[6]:.0f}Hz' for r in males)}")
print(f"男声组 f0 极差: {max(mf0)-min(mf0):.1f} Hz")
