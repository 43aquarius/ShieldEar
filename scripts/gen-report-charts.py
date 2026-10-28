#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
声盾参赛技术报告 — 图表生成（基于真实校准数据 calibration/features.json 与评测输出）
图1：八维特征类间分离度（宽带/窄带）
图2：逐文件合成置信度（自然类 vs 合成类，宽带）
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.font_manager as fm

for fp in ['/usr/share/fonts/truetype/chinese/NotoSansSC[wght].ttf',
           '/usr/share/fonts/truetype/chinese/SarasaMonoSC-Regular.ttf']:
    try:
        fm.fontManager.addfont(fp)
    except Exception:
        pass
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams['font.sans-serif'] = ['Noto Sans SC', 'Sarasa Mono SC', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

ACCENT = "#0E9F6E"
WARN = "#B8860B"
RED = "#C0392B"
GRID = "#E0E6E3"
TEXT = "#333333"

OUT = "/home/z/my-project/download/assets"
import os
os.makedirs(OUT, exist_ok=True)

# ============ 图1：特征分离度 ============
features = ["谐波规整度\n(hnr)", "过零率波动度\n(zcrCV)", "谱通量波动度\n(fluxCV)",
            "高频周期性\n(hfPeriodicity)", "高频能量占比\n(hfEnergyRatio)",
            "嗓音动力波动\n(hnrCV)", "基音微扰\n(jitter)", "高频谱平坦度\n(hfFlatness)"]
sep_wide = [2.17, 1.25, 1.55, 1.28, 1.17, 0.64, 0.60, 0.10]
sep_narrow = [2.04, 1.90, 1.19, 0.68, 0.34, 0.29, 0.16, 1.01]

fig, ax = plt.subplots(figsize=(8.6, 4.6), constrained_layout=True)
y = np.arange(len(features))
h = 0.36
b1 = ax.barh(y - h/2, sep_wide, h, label="宽带信道", color=ACCENT, alpha=0.92)
b2 = ax.barh(y + h/2, sep_narrow, h, label="窄带（电话）信道", color="#7FA8C9", alpha=0.92)
ax.set_yticks(y)
ax.set_yticklabels(features, fontsize=10)
ax.invert_yaxis()
ax.set_xlabel("类间分离度（均值差 / 合并标准差，越大越可分）", fontsize=10.5, color=TEXT)
ax.set_title("八维声学特征：自然人声 vs 神经 TTS 合成语音的类间分离度", fontsize=12.5, pad=10, color=TEXT)
ax.axvline(1.0, color=WARN, ls="--", lw=1, alpha=0.8)
ax.text(1.03, len(features)-0.35, "可用性参考线 1.0", fontsize=8.5, color=WARN)
ax.grid(axis="x", color=GRID, lw=0.7)
ax.set_axisbelow(True)
for spine in ["top", "right"]:
    ax.spines[spine].set_visible(False)
ax.legend(loc="lower right", fontsize=10, frameon=False)
for bars in (b1, b2):
    for rect in bars:
        w = rect.get_width()
        if w > 0.05:
            ax.text(w + 0.03, rect.get_y() + rect.get_height()/2, f"{w:.2f}",
                    va="center", fontsize=8.2, color="#666")
fig.savefig(f"{OUT}/chart_feature_sep.png", dpi=200, facecolor="white")
plt.close(fig)

# ============ 图2：逐文件判决置信度 ============
nat = [("ws_demo", 0.254), ("ws_mono", 0.176), ("viper", 0.156), ("librivox", 0.639), ("ws_audio", 0.115)]
tts = [("tongtong_1", 0.838), ("luodo_2", 0.813), ("chuichui_1", 0.792), ("xiaochen_2", 0.749),
       ("douji_1", 0.743), ("chuichui_0", 0.727), ("chuichui_2", 0.732), ("jam_1", 0.724),
       ("douji_0", 0.721), ("tongtong_0", 0.759), ("tongtong_2", 0.704), ("douji_2", 0.706),
       ("luodo_0", 0.677), ("xiaochen_1", 0.666), ("jam_2", 0.655), ("luodo_1", 0.641),
       ("kazi_2", 0.608), ("kazi_0", 0.584), ("kazi_1", 0.553), ("jam_0", 0.719)]

rows = list(reversed(nat)) + list(reversed(tts))
names = [r[0] for r in rows]
vals = [r[1] for r in rows]
colors = [ACCENT if i < len(nat) else RED for i in range(len(rows))]

fig, ax = plt.subplots(figsize=(8.6, 7.2), constrained_layout=True)
bars = ax.barh(range(len(rows)), vals, color=colors, alpha=0.9, height=0.62)
ax.set_yticks(range(len(rows)))
ax.set_yticklabels(names, fontsize=8.6, fontfamily='DejaVu Sans')
ax.set_xlabel("整段合成置信度（能量加权逐窗均值）", fontsize=10.5, color=TEXT)
ax.set_title("逐文件判决结果：自然语音（n=5）与 TTS 合成语音（n=20）\n宽带信道 · ShieldEar v1.3 引擎", fontsize=12.5, pad=10, color=TEXT)
ax.axvline(0.55, color=RED, ls="--", lw=1.1, alpha=0.85)
ax.text(0.556, 1.0, "高风险阈值 0.55", fontsize=8.8, color=RED)
ax.axvline(0.35, color=WARN, ls=":", lw=1.1, alpha=0.9)
ax.text(0.356, 5.6, "中风险阈值 0.35", fontsize=8.8, color=WARN)
ax.set_xlim(0, 1.0)
ax.grid(axis="x", color=GRID, lw=0.7)
ax.set_axisbelow(True)
for spine in ["top", "right"]:
    ax.spines[spine].set_visible(False)
from matplotlib.patches import Patch
ax.legend(handles=[Patch(color=ACCENT, label="自然语音（期望低分）"), Patch(color=RED, label="TTS 合成语音（期望高分）")],
          loc="lower right", fontsize=9.5, frameon=False)
for rect, v in zip(bars, vals):
    ax.text(v + 0.012, rect.get_y() + rect.get_height()/2, f"{v:.3f}", va="center", fontsize=7.8, color="#666")
fig.savefig(f"{OUT}/chart_file_scores.png", dpi=200, facecolor="white")
plt.close(fig)

print("charts saved:", os.listdir(OUT))
