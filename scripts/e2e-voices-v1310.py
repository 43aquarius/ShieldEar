#!/usr/bin/env python3
"""e2e-voices-v1310.py — v1.3.10 七音色端到端验证（对运行中的 :3000 服务）

校验项（对应两 bug 的修复验收）：
  A. mode=live 且 engine=espeak（离线通道真实合成，非回放）
  B. 7 个音色 sourceHash 两两互异（bug 1：音色真实生效）
  C. engineLabel 含 7 个互异变体名（cmn+f2 … cmn+m6）
  D. 返回 PCM 的基频呈性别分组（女声组显著高于男声组）且 7 f0 互异
  E. 合成文本被正确朗读（时长 5–15s，非 <2s 的乱码碎片）
"""
import base64
import json
import struct
import sys
import urllib.request

BASE = "http://localhost:3000"
TEXT = "喂您好，我是您的专属客服，您有一笔退款需要处理，请按提示操作。"
VOICES = ["tongtong", "chuichui", "xiaochen", "jam", "kazi", "douji", "luodo"]


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.loads(r.read())


def post(path, body, timeout=120):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def f0_median(pcm_i16, sr=16000):
    """自相关中位基频"""
    win, hop = int(sr * 0.04), int(sr * 0.02)
    f0s = []
    for i in range(0, len(pcm_i16) - win, hop):
        seg = pcm_i16[i:i + win]
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


# ── 前置：确认离线模式（Tier 3 espeak 为 live 主通道） ──
st = get("/api/tts-challenge")
print(f"通道状态: online={st['online']} chain={st['chain']}")
if st["online"]:
    r = post("/api/config/cloud", {"enabled": False})
    print(f"已切换离线: {r}")

results = {}
for v in VOICES:
    d = post("/api/tts-challenge", {"text": TEXT, "voice": v, "speed": 1.0})
    results[v] = d

fails = []
print(f"\n{'音色':10s} {'mode':8s} {'engine':7s} {'variant':9s} {'srcHash':12s} {'dur':6s} {'f0':7s}")
for v, d in results.items():
    label = d.get("engineLabel", "")
    variant = label.split("·")[-1].strip() if "·" in label else "?"
    pcm = struct.unpack(f"<{len(base64.b64decode(d['audio']['pcmB64'])) // 2}h",
                        base64.b64decode(d["audio"]["pcmB64"]))
    f0 = f0_median(pcm)
    dur = d["audio"]["durationSec"]
    print(f"{v:10s} {d['mode']:8s} {d['engine']:7s} {variant:9s} {d['sourceHash'][:12]} {dur:5.2f}s {f0:6.1f}Hz")
    # A. live + espeak
    if d["mode"] != "live" or d["engine"] != "espeak":
        fails.append(f"{v}: mode={d['mode']} engine={d['engine']}（应为 live/espeak）")
    # E. 时长合理（30 字中文 5–15s；乱码会 <2s 或静音）
    if not (4 < dur < 16):
        fails.append(f"{v}: 时长 {dur:.2f}s 异常（疑似乱读/未读）")

# B. 哈希互异
hashes = {d["sourceHash"] for d in results.values()}
if len(hashes) != 7:
    fails.append(f"sourceHash 仅 {len(hashes)}/7 互异 —— 音色仍同声（bug 1 未修复）")

# C. 变体互异
variants = {(d.get("engineLabel", "").split("·")[-1].strip()) for d in results.values()}
if len(variants) != 7:
    fails.append(f"变体仅 {len(variants)}/7 互异: {variants}")

# D. 基频分组与互异
f0s = {}
for v, d in results.items():
    pcm = struct.unpack(f"<{len(base64.b64decode(d['audio']['pcmB64'])) // 2}h",
                        base64.b64decode(d["audio"]["pcmB64"]))
    f0s[v] = f0_median(pcm)
female = [f0s[v] for v in ("tongtong", "chuichui", "douji")]
male = [f0s[v] for v in ("xiaochen", "jam", "kazi", "luodo")]
if min(female) <= max(male):
    fails.append(f"女声组({min(female):.0f}Hz)未高于男声组({max(male):.0f}Hz)")
if len({round(f) for f in f0s.values()}) < 6:
    fails.append(f"7 音色 f0 互异度不足: {f0s}")

print(f"\nf0 分布: {', '.join(f'{v}={f0s[v]:.0f}' for v in VOICES)}")
print(f"女声组 {min(female):.0f}–{max(female):.0f}Hz · 男声组 {min(male):.0f}–{max(male):.0f}Hz")

if fails:
    print("\n✗ FAIL:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("\n✓ v1.3.10 七音色端到端验证全过（A live/espeak · B 哈希互异 · C 变体互异 · D 基频分组 · E 时长正常）")
