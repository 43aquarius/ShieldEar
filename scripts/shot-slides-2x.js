#!/usr/bin/env node
/**
 * shot-slides-2x.js — 答辩 PPT 交付截图（deviceScaleFactor=2 → 2560×1440）
 * 用法: node shot-slides-2x.js <slides目录> <输出目录>
 * 依赖 qa_slides.js 已过四查；本脚本只管高清出图（等字体/CDN 稳定后截图）
 */
const path = require('path');
const fs = require('fs');

function requireG(mod) {
  try { return require(mod); }
  catch (e) { return require(path.join('/usr/local/lib/node_modules', mod)); }
}
const { chromium } = requireG('playwright');

const SLIDES_DIR = process.argv[2] || '/home/z/my-project/docs/slides';
const OUT_DIR = process.argv[3] || '/home/z/my-project/docs/slides_qa/2x';

(async () => {
  const files = fs.readdirSync(SLIDES_DIR).filter(f => /^slide_\d+\.html$/.test(f)).sort();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  for (const f of files) {
    const url = 'file://' + path.join(SLIDES_DIR, f);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(async () => {
      await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    });
    await page.waitForTimeout(700); // 字体/Tailwind 稳定
    await page.screenshot({ path: path.join(OUT_DIR, f.replace('.html', '.png')) });
    console.log('shot 2x:', f);
  }
  await browser.close();
  console.log('OK ' + files.length + ' shots → ' + OUT_DIR);
})();
