#!/usr/bin/env python3
"""
build-pptx-v1315.py — 声盾答辩 PPT 重建（v1.3.15 口径）
模式：整页 2x 截图（2560×1440）满幅嵌入 + HTML aside[data-notes] 逐字稿为讲者备注。
理由：原文本层生成管线已遗失（worklog 遗留记录）；截图模式与 HTML 渲染 100% 一致，
     文字已栅格化，SOP 字体塌缩问题自动消除；备注保留完整逐字稿。
用法: python3 build-pptx-v1315.py
产出: docs/声盾-答辩演示.pptx
"""
import re
import sys
from pathlib import Path

from pptx import Presentation
from pptx.util import Emu

SLIDES_DIR = Path("/home/z/my-project/docs/slides")
SHOTS_DIR = Path("/home/z/my-project/docs/slides_qa/2x")
OUT = Path("/home/z/my-project/docs/声盾-答辩演示.pptx")

SLIDE_W = 9144000   # 10 in
SLIDE_H = 5143500   # 5.625 in (16:9)


def extract_notes(html_path: Path) -> str:
    html = html_path.read_text(encoding="utf-8")
    m = re.search(r"<aside[^>]*data-notes[^>]*>(.*?)</aside>", html, re.S)
    if not m:
        raise ValueError(f"notes 缺失: {html_path.name}")
    text = re.sub(r"<[^>]+>", "", m.group(1))
    return re.sub(r"\s+", "", text)


def main() -> None:
    htmls = sorted(SLIDES_DIR.glob("slide_*.html"))
    assert len(htmls) == 13, f"应有 13 页，实得 {len(htmls)}"

    prs = Presentation()
    prs.slide_width = Emu(SLIDE_W)
    prs.slide_height = Emu(SLIDE_H)
    blank = prs.slide_layouts[6]

    for hp in htmls:
        shot = SHOTS_DIR / (hp.stem + ".png")
        if not shot.exists():
            raise FileNotFoundError(shot)
        notes = extract_notes(hp)
        slide = prs.slides.add_slide(blank)
        slide.shapes.add_picture(str(shot), 0, 0, width=Emu(SLIDE_W), height=Emu(SLIDE_H))
        slide.notes_slide.notes_text_frame.text = notes

    prs.save(OUT)

    # ── 自校验 ──
    chk = Presentation(str(OUT))
    n = len(chk.slides)
    ratio = chk.slide_width / chk.slide_height
    ok_ratio = abs(ratio - 16 / 9) < 0.01
    notes_ok = sum(
        1 for s in chk.slides
        if s.has_notes_slide and len(s.notes_slide.notes_text_frame.text.strip()) >= 60
    )
    pic_ok = all(
        sum(1 for sh in s.shapes if sh.shape_type == 13) == 1 for s in chk.slides
    )
    print(f"页数: {n}/13 · 16:9: {ok_ratio} · 备注≥60字: {notes_ok}/13 · 每页1满幅图: {pic_ok}")
    if n == 13 and ok_ratio and notes_ok == 13 and pic_ok:
        print(f"✓ 交付验证通过 → {OUT}")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
