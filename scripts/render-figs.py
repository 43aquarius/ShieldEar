#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""渲染架构图与软件流程图（Playwright + CSS → PNG，device_scale_factor=2）"""
import asyncio
import os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(ROOT)
OUTDIR = os.environ.get("FIG_OUT", os.path.join(PROJECT, "download", "assets"))
JOBS = [
    (os.path.join(ROOT, "fig-architecture.html"),
     os.path.join(OUTDIR, "fig_architecture.png")),
    (os.path.join(ROOT, "fig-pipeline.html"),
     os.path.join(OUTDIR, "fig_pipeline.png")),
]

async def render(html_path, output_path, selector="#root", width=1400, scale=2):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={"width": width, "height": 900},
            device_scale_factor=scale,
        )
        await page.goto(f"file://{html_path}", wait_until="networkidle")
        await page.wait_for_timeout(400)
        el = page.locator(selector)
        bbox = await el.bounding_box()
        if bbox:
            fit_w = max(width, int(bbox["width"] + 60))
            fit_h = int(bbox["height"] + 60)
            await page.set_viewport_size({"width": fit_w, "height": fit_h})
            await page.wait_for_timeout(200)
        await el.screenshot(path=output_path)
        await browser.close()
        print(f"OK {output_path} ({os.path.getsize(output_path)/1024:.0f}KB)")

async def main():
    for html, out in JOBS:
        await render(html, out)

asyncio.run(main())
