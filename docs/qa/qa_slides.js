#!/usr/bin/env node
/**
 * qa_slides.js — SOP §7.1 几何层 + §7.3 文本层三查
 * 用法: node qa_slides.js <slides目录> <截图目录(可选)>
 * 检查: ① scrollWidth/scrollHeight == 1280/720（零滚动，白名单出血除外）
 *       ② 单页正文 CJK 字符量 ≥ 60（防排版组件静默吞正文）
 *       ③ aside[data-notes] 逐字稿存在且 ≥ 60 字
 *       ④ 图片 naturalWidth > 0（防图片静默失败）
 */
const path = require('path');
const fs = require('fs');

const SLIDES_DIR = process.argv[2] || '/home/z/my-project/download/slides';
const SHOT_DIR = process.argv[3] || '';

// 刻意出血白名单（SOP §7.4 登记制）：页面 → 允许的超宽/超高像素
const BLEED_WHITELIST = {
  'slide_13.html': { w: 40, h: 70 }, // 右下幽灵大数字 340px 刻意出血
};

function requireG(mod) {
  try { return require(mod); }
  catch (e) { return require(path.join('/usr/local/lib/node_modules', mod)); }
}
const { chromium } = requireG('playwright');

(async () => {
  const files = fs.readdirSync(SLIDES_DIR).filter(f => /^slide_\d+\.html$/.test(f)).sort();
  if (!files.length) { console.error('no slides found in ' + SLIDES_DIR); process.exit(1); }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  let failures = 0;
  for (const f of files) {
    const url = 'file://' + path.join(SLIDES_DIR, f);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(async () => {
      await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    });
    await page.waitForTimeout(600); // 字体/Tailwind 稳定

    const m = await page.evaluate(() => {
      const de = document.documentElement, b = document.body;
      const notes = document.querySelector('aside[data-notes]');
      const notesText = notes ? notes.textContent.replace(/\s+/g, '') : '';
      const asideIsLast = notes ? notes === b.lastElementChild : false;
      const slide = document.querySelector('.slide');
      const visible = slide ? slide.innerText : b.innerText;
      const cjk = (visible.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
      const imgs = [...document.querySelectorAll('img')].map(i => ({ src: i.getAttribute('src'), ok: i.naturalWidth > 0 }));
      const notesCJK = (notesText.match(/[\u4e00-\u9fff]/g) || []).length;
      return {
        sw: Math.max(de.scrollWidth, b.scrollWidth),
        sh: Math.max(de.scrollHeight, b.scrollHeight),
        cjk, notesCJK, asideIsLast, imgs,
      };
    });

    const wl = BLEED_WHITELIST[f] || { w: 0, h: 0 };
    const overW = m.sw - 1280, overH = m.sh - 720;
    const geomOK = overW <= wl.w && overH <= wl.h;
    const textOK = m.cjk >= 60;
    const notesOK = m.notesCJK >= 60 && m.asideIsLast;
    const imgsOK = m.imgs.every(i => i.ok);

    const issues = [];
    if (overW > wl.w) issues.push(`超宽 ${overW}px(白名单${wl.w})`);
    if (overH > wl.h) issues.push(`超高 ${overH}px(白名单${wl.h})`);
    if (!textOK) issues.push(`正文CJK仅${m.cjk}字`);
    if (!notesOK) issues.push(`备注缺失/过短(${m.notesCJK}字)或非body末子元素`);
    if (!imgsOK) issues.push('图片加载失败:' + m.imgs.filter(i => !i.ok).map(i => i.src).join(','));

    if (SHOT_DIR) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOT_DIR, f.replace('.html', '.png')) });
    }

    if (issues.length) { failures++; console.log(`✗ ${f}  ${issues.join(' | ')}`); }
    else console.log(`✓ ${f}  ${m.sw}x${m.sh} · 正文${m.cjk}字 · 讲稿${m.notesCJK}字 · 图${m.imgs.length}`);
  }

  await browser.close();
  console.log(failures ? `\n${failures} 页存在问题` : `\n全部 ${files.length} 页通过（几何/文本/备注/图片）`);
  process.exit(failures ? 1 : 0);
})();
