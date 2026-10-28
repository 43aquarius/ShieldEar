#!/usr/bin/env python3
"""montage_slides.py — SOP §7.2 蒙太奇拼图（VLM 初筛用）
把 QA 截图按组拼成 2-3 张蒙太奇（每张 4-5 页）。
用法: python3 montage_slides.py <截图目录>
"""
import sys, os
from PIL import Image

def montage(paths, out, cols=3):
    imgs = [Image.open(p) for p in paths]
    w, h = imgs[0].size
    rows = (len(imgs) + cols - 1) // cols
    GAP = 8
    canvas = Image.new('RGB', (cols * w + (cols + 1) * GAP, rows * h + (rows + 1) * GAP), '#777777')
    for i, im in enumerate(imgs):
        r, c = divmod(i, cols)
        canvas.paste(im, (GAP + c * (w + GAP), GAP + r * (h + GAP)))
    canvas.save(out, optimize=True)
    print(out, canvas.size)

if __name__ == '__main__':
    d = sys.argv[1]
    files = sorted(f for f in os.listdir(d) if f.startswith('slide_') and f.endswith('.png'))
    groups = [files[:5], files[5:9], files[9:]]
    for i, g in enumerate(groups):
        montage([os.path.join(d, f) for f in g], os.path.join(d, f'montage_{chr(65+i)}.png'),
                cols=3 if len(g) == 5 else 2)
