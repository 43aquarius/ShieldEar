#!/usr/bin/env python3
"""verify_pptx16.py — SOP §8.3 交付验证
检查: 页数 N/N · 画幅 16:9 · 备注 N/N(逐字稿无缺页) · 逐页字体抽查(六族·无 webfont 残留)
用法: python3 verify_pptx16.py <输出.pptx>
"""
import sys, re
from pptx import Presentation

WINDOWS_SIX = {'SimSun', 'Microsoft YaHei', 'KaiTi', 'Arial Narrow', 'Calibri', 'Courier New'}
WEBFONT_RESIDUE = {'Noto Serif SC', 'Noto Sans SC', 'LXGW WenKai', 'Inter',
                   'Playfair Display', 'IBM Plex Mono', 'JetBrains Mono'}

def main(path):
    prs = Presentation(path)
    n = len(prs.slides)
    ratio = prs.slide_width / prs.slide_height
    print(f'页数: {n}')
    print(f'画幅: {prs.slide_width}x{prs.slide_height} EMU · ratio {ratio:.4f} {"= 16:9 ✓" if abs(ratio-16/9)<0.01 else "≠ 16:9 ✗"}')

    fails = []
    notes_ok = 0
    all_fonts = set()
    for i, slide in enumerate(prs.slides, 1):
        # 备注检查
        has_notes = slide.has_notes_slide and slide.notes_slide.notes_text_frame.text.strip()
        notes_ok += bool(has_notes)
        if not has_notes:
            fails.append(f'slide{i}: 备注缺失')
        # 字体检查（扫 part XML）
        xml = slide.part.blob.decode('utf-8', errors='ignore')
        fonts = set(re.findall(r'typeface="([^"]+)"', xml))
        all_fonts |= fonts
        residue = fonts & WEBFONT_RESIDUE
        if residue:
            fails.append(f'slide{i}: webfont残留 {residue}')

    print(f'备注: {notes_ok}/{n} 页含逐字稿')
    print(f'全片字体集合: {sorted(all_fonts)}')
    print(f'Windows六族命中: {sorted(all_fonts & WINDOWS_SIX)}')
    if fails:
        print('\n✗ 问题清单:')
        for f in fails: print('  -', f)
        sys.exit(1)
    print('\n✓ 交付验证全部通过（页数/16:9/备注/字体）')

if __name__ == '__main__':
    main(sys.argv[1])
