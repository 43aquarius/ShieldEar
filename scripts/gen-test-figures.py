#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
声盾系统测试报告 — 图表生成（全部读取 calibration/testsuite_results.json 真实测试数据）
图1：双信道混淆矩阵
图2：分组正确率
图3：合成置信度分数分布（自然 vs 合成 × 宽带/窄带）
图4：实时性（单窗分析时延 + 整段 RTF）
图5：T3 退化类型检出率 + 分音色检出率
"""
import json
import os

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

# 与技术报告图表一致的配色
ACCENT = "#0E9F6E"
BLUE = "#7FA8C9"
WARN = "#B8860B"
RED = "#C0392B"
GRID = "#E0E6E3"
TEXT = "#333333"
OK_TINT = "#E6F4EE"      # 正确格浅绿
ERR_TINT = "#FBEDEB"     # 错误格浅红

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get("FIG_OUT", os.path.join(ROOT, "download", "assets"))
os.makedirs(OUT, exist_ok=True)

DATA = json.load(open(os.path.join(ROOT, 'calibration', 'testsuite_results.json')))
ITEMS = DATA['items']
SUM = DATA['summary']
MB = DATA['microbench']

def despine(ax):
    for s in ["top", "right"]:
        ax.spines[s].set_visible(False)

# ============ 图1：双信道混淆矩阵 ============
fig, axes = plt.subplots(1, 2, figsize=(9.6, 4.5), constrained_layout=True)
for ax, ch, subtitle in zip(axes, ["wideband", "narrowband"], ["宽带信道", "窄带（电话）信道"]):
    m = SUM['byChannel'][ch]
    mat = np.array([[m['tp'], m['fn']], [m['fp'], m['tn']]])
    row_total = mat.sum(axis=1, keepdims=True)
    pct = mat / row_total * 100
    for i in range(2):
        for j in range(2):
            ok = (i == j)
            ax.add_patch(plt.Rectangle((j, 1 - i), 1, 1,
                                       facecolor=OK_TINT if ok else ERR_TINT,
                                       edgecolor=GRID, lw=1.5))
            ax.text(j + 0.5, 1 - i + 0.62, f"{mat[i, j]}", ha="center", va="center",
                    fontsize=17, fontweight="bold", color=TEXT)
            ax.text(j + 0.5, 1 - i + 0.30, f"({pct[i, j]:.1f}%)", ha="center", va="center",
                    fontsize=9.5, color="#777")
            ax.text(j + 0.5, 1 - i + 0.86,
                    ["TP 检出", "FN 漏报", "FP 误报", "TN 放行"][i * 2 + j],
                    ha="center", va="center", fontsize=8.5, color="#999")
    ax.set_xlim(0, 2); ax.set_ylim(0, 2)
    ax.set_xticks([0.5, 1.5])
    ax.set_xticklabels(["判为合成\n(HIGH/CRITICAL)", "判为正常\n(LOW/MEDIUM)"], fontsize=10)
    ax.set_yticks([0.5, 1.5])
    ax.set_yticklabels(["真实类别：\n合成语音", "真实类别：\n自然人声"], fontsize=10)
    acc = m['accuracy'] * 100
    ax.set_title(f"{subtitle}  —  准确率 {acc:.1f}%", fontsize=12, pad=10, color=TEXT)
    ax.tick_params(length=0)
    for s in ax.spines.values():
        s.set_visible(False)
fig.suptitle("双信道混淆矩阵（210 条判决：合成 160 / 自然 50）", fontsize=13.5, color=TEXT)
fig.savefig(f"{OUT}/test_confusion.png", dpi=200, facecolor="white", bbox_inches=None)
plt.close(fig)

# ============ 图2：分组正确率 ============
groups = [g for g in ['N1', 'N2', 'T1', 'T2', 'T3'] if SUM['byGroup'][g]['available']]
labels_map = {
    'N1': '自然-原始', 'N2': '自然-鲁棒变体', 'T1': '合成-校准集',
    'T2': '合成-独立测试集', 'T3': '合成-退化变体',
}
wide_rates, narrow_rates, counts = [], [], []
for g in groups:
    gw = [i for i in ITEMS if i['group'] == g and i['channel'] == 'wideband']
    gn = [i for i in ITEMS if i['group'] == g and i['channel'] == 'narrowband']
    okw = sum(1 for i in gw if i['result'] in ('detect', 'pass'))
    okn = sum(1 for i in gn if i['result'] in ('detect', 'pass'))
    wide_rates.append(okw / len(gw) * 100 if gw else 0)
    narrow_rates.append(okn / len(gn) * 100 if gn else 0)
    counts.append(len(gw) + len(gn))

fig, ax = plt.subplots(figsize=(8.8, 4.4), constrained_layout=True)
x = np.arange(len(groups))
w = 0.36
b1 = ax.bar(x - w/2, wide_rates, w, label="宽带信道", color=ACCENT, alpha=0.92)
b2 = ax.bar(x + w/2, narrow_rates, w, label="窄带（电话）信道", color=BLUE, alpha=0.92)
for bars, rates in [(b1, wide_rates), (b2, narrow_rates)]:
    for rect, r in zip(bars, rates):
        ax.text(rect.get_x() + rect.get_width()/2, r + 2.2, f"{r:.0f}%",
                ha="center", fontsize=9.5, color=TEXT)
ax.set_xticks(x)
ax.set_xticklabels([f"{labels_map[g]}\n(n={counts[i]})" for i, g in enumerate(groups)], fontsize=10)
ax.set_ylim(0, 118)
ax.set_ylabel("判决正确率（%）", fontsize=10.5, color=TEXT)
ax.set_title("测试分组判决正确率：抗误报（N 组）与检出（T 组）", fontsize=12.5, pad=10, color=TEXT)
ax.axhline(80, color=WARN, ls="--", lw=1, alpha=0.7)
ax.text(len(groups) - 0.42, 81.5, "80% 参考线", fontsize=8.5, color=WARN, ha="right")
ax.grid(axis="y", color=GRID, lw=0.7)
ax.set_axisbelow(True)
despine(ax)
ax.legend(loc="lower left", fontsize=10, frameon=False, ncol=2)
fig.savefig(f"{OUT}/test_groups.png", dpi=200, facecolor="white")
plt.close(fig)

# ============ 图3：分数分布 ============
fig, ax = plt.subplots(figsize=(8.8, 4.6), constrained_layout=True)
box_data, box_labels, box_colors = [], [], []
for cls, clabel, color in [('natural', '自然人声', ACCENT), ('tts', '合成语音', RED)]:
    for ch, chlabel in [('wideband', '宽带'), ('narrowband', '窄带')]:
        vals = [i['syntheticRatio'] for i in ITEMS if i['cls'] == cls and i['channel'] == ch]
        box_data.append(vals)
        box_labels.append(f"{clabel}\n{chlabel} (n={len(vals)})")
        box_colors.append(color)
bp = ax.boxplot(box_data, patch_artist=True, widths=0.52, showfliers=True,
                medianprops=dict(color=TEXT, lw=1.6),
                flierprops=dict(marker='o', markersize=3.5, markerfacecolor='#BBB',
                                markeredgecolor='none', alpha=0.7))
for patch, c in zip(bp['boxes'], box_colors):
    patch.set_facecolor(c)
    patch.set_alpha(0.35)
    patch.set_edgecolor(c)
    patch.set_linewidth(1.4)
for whisker in bp['whiskers']:
    whisker.set_color('#999'); whisker.set_linewidth(1.1)
for cap in bp['caps']:
    cap.set_color('#999'); cap.set_linewidth(1.1)
ax.axhline(0.55, color=RED, ls="--", lw=1.2, alpha=0.85)
ax.text(4.42, 0.565, "HIGH 阈值 0.55", fontsize=8.5, color=RED, ha="right")
ax.axhline(0.35, color=WARN, ls="--", lw=1.2, alpha=0.85)
ax.text(4.42, 0.362, "MEDIUM 阈值 0.35", fontsize=8.5, color=WARN, ha="right")
ax.set_xticks(range(1, 5))
ax.set_xticklabels(box_labels, fontsize=9.5)
ax.set_ylabel("整段合成置信度 syntheticRatio", fontsize=10.5, color=TEXT)
ax.set_ylim(-0.04, 1.0)
ax.set_title("判决分数分布：类间分离与重叠带（诚实边界可见）", fontsize=12.5, pad=10, color=TEXT)
ax.grid(axis="y", color=GRID, lw=0.7)
ax.set_axisbelow(True)
despine(ax)
fig.savefig(f"{OUT}/test_scores.png", dpi=200, facecolor="white")
plt.close(fig)

# ============ 图4：实时性 ============
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.8, 4.3), constrained_layout=True)

# 左：单窗分析时延
lat = [("中位数 P50", MB['p50Ms']), ("P95", MB['p95Ms']), ("P99", MB['p99Ms']), ("最大值", MB['maxMs'])]
names = [l[0] for l in lat]
vals = [l[1] for l in lat]
bars = ax1.bar(names, vals, color=ACCENT, alpha=0.92, width=0.55)
for rect, v in zip(bars, vals):
    ax1.text(rect.get_x() + rect.get_width()/2, v * 1.15, f"{v:.1f} ms",
             ha="center", fontsize=10, color=TEXT)
ax1.axhline(1000, color=RED, ls="--", lw=1.4, alpha=0.9)
ax1.text(3.4, 1300, "判决时延预算 1000 ms（1 s 窗步进）", fontsize=8.8, color=RED, ha="right")
ax1.set_yscale("log")
ax1.set_ylim(1, 4000)
ax1.set_ylabel("单窗（2s）分析时延（ms，对数轴）", fontsize=10, color=TEXT)
ax1.set_title(f"单窗分析时延：P99 = {MB['p99Ms']:.1f} ms", fontsize=12, pad=10, color=TEXT)
ax1.grid(axis="y", color=GRID, lw=0.7)
ax1.set_axisbelow(True)
despine(ax1)

# 右：整段 RTF
rtf = SUM['rtf']
rtf_items = [("中位数 P50", rtf['p50']), ("P95", rtf['p95']), ("最大值", rtf['max'])]
names2 = [r[0] for r in rtf_items]
vals2 = [r[1] for r in rtf_items]
bars2 = ax2.bar(names2, vals2, color=BLUE, alpha=0.95, width=0.5)
for rect, v in zip(bars2, vals2):
    ax2.text(rect.get_x() + rect.get_width()/2, v * 1.2, f"{v:.4f}",
             ha="center", fontsize=10, color=TEXT)
ax2.axhline(1.0, color=RED, ls="--", lw=1.4, alpha=0.9)
ax2.text(2.4, 1.5, "实时线 RTF = 1.0", fontsize=8.8, color=RED, ha="right")
ax2.set_yscale("log")
ax2.set_ylim(0.001, 10)
ax2.set_ylabel("实时因子 RTF（对数轴）", fontsize=10, color=TEXT)
ax2.set_title(f"整段分析实时因子：最大 {rtf['max']:.4f}", fontsize=12, pad=10, color=TEXT)
ax2.grid(axis="y", color=GRID, lw=0.7)
ax2.set_axisbelow(True)
despine(ax2)
fig.suptitle("实时性测试：纯 CPU 引擎距实时预算两个数量级以上", fontsize=13, color=TEXT)
fig.savefig(f"{OUT}/test_latency.png", dpi=200, facecolor="white")
plt.close(fig)

# ============ 图5：T3 退化细分 + 分音色 ============
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10.2, 4.4), constrained_layout=True)

# 左：T3 按退化类型 × 信道
vt_labels = {'noise20': '20dB 加噪', 'speed105': '1.05 变速', 'mp3': 'MP3 编解码'}
x = np.arange(3)
w = 0.36
det_w, det_n = [], []
for vt in ['noise20', 'speed105', 'mp3']:
    for ch, arr in [('wideband', det_w), ('narrowband', det_n)]:
        sel = [i for i in ITEMS if i['group'] == 'T3' and vt in i['name'] and i['channel'] == ch]
        arr.append(sum(1 for i in sel if i['result'] == 'detect') / len(sel) * 100)
b1 = ax1.bar(x - w/2, det_w, w, label="宽带", color=ACCENT, alpha=0.92)
b2 = ax1.bar(x + w/2, det_n, w, label="窄带（电话）", color=BLUE, alpha=0.92)
for bars, rates in [(b1, det_w), (b2, det_n)]:
    for rect, r in zip(bars, rates):
        ax1.text(rect.get_x() + rect.get_width()/2, r + 2.2, f"{r:.0f}%",
                 ha="center", fontsize=9.3, color=TEXT)
ax1.set_xticks(x)
ax1.set_xticklabels([vt_labels[v] for v in ['noise20', 'speed105', 'mp3']], fontsize=10)
ax1.set_ylim(0, 118)
ax1.set_ylabel("检出率（%）", fontsize=10.5, color=TEXT)
ax1.set_title("退化类型 × 信道检出率（每格 n=20）", fontsize=11.5, pad=10, color=TEXT)
ax1.grid(axis="y", color=GRID, lw=0.7)
ax1.set_axisbelow(True)
despine(ax1)
ax1.legend(loc="lower left", fontsize=9.5, frameon=False)

# 右：分音色（T1+T3 全部合成判决）
voices = sorted(SUM['byVoice'].items(), key=lambda kv: -(kv[1]['detected'] / kv[1]['total']))
vnames = [v[0] for v in voices]
vrates = [v[1]['detected'] / v[1]['total'] * 100 for v in voices]
vtotal = [v[1]['total'] for v in voices]
colors = [ACCENT if r == 100 else (BLUE if r >= 80 else WARN) for r in vrates]
bars = ax2.barh(vnames[::-1], vrates[::-1], color=colors[::-1], alpha=0.92, height=0.6)
for rect, r, t in zip(bars, vrates[::-1], vtotal[::-1]):
    ax2.text(r + 2, rect.get_y() + rect.get_height()/2, f"{r:.0f}% (n={t})",
             va="center", fontsize=9.3, color=TEXT)
ax2.set_xlim(0, 132)
ax2.set_xlabel("检出率（%）", fontsize=10.5, color=TEXT)
ax2.set_title("分音色检出率（7 音色，宽带+窄带合并）", fontsize=11.5, pad=10, color=TEXT)
ax2.grid(axis="x", color=GRID, lw=0.7)
ax2.set_axisbelow(True)
despine(ax2)
fig.suptitle("合成语音检出鲁棒性：退化链路与音色差异", fontsize=13, color=TEXT)
fig.savefig(f"{OUT}/test_t3voice.png", dpi=200, facecolor="white")
plt.close(fig)

print("已生成 5 张测试图表 →", OUT)
for f in ["test_confusion.png", "test_groups.png", "test_scores.png", "test_latency.png", "test_t3voice.png"]:
    p = os.path.join(OUT, f)
    print(f"  {f}: {os.path.getsize(p)} bytes")
