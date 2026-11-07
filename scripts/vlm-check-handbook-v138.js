const ZAI = require('z-ai-web-dev-sdk').default;
const fs = require('fs');
// v1.3.8 手册 13 页；pg-XX.jpg 由 /tmp/hb-check 渲染
const PAGES = [1, 2, 5, 8, 11, 13];
const EXPECT = {
  1: '深色封面页：标题「声盾答辩演示手册」、副标题含 v1.3.8、队名（你们说的对）与日期',
  2: '目录页（罗马页码）：列出演示前检查/五幕演示等章节',
  5: '演示剧本页：应含首页或判决剧场截图（深色界面、绿色声纹律动或琥珀色印章）',
  8: '关键数字速查卡大表格（含断网 8/8、便携包 70.2MB、跨引擎一致率等行）',
  11: '应急预案页（含 windows-smoke.cmd 一键定位条目）',
  13: '附录页（v1.3.8 交付摘要：双文件名 DLL、SHA-256 等），文档最后一页',
};
(async () => {
  const zai = await ZAI.create();
  for (const p of PAGES) {
    const img = fs.readFileSync(`/tmp/hb-check/pg-${String(p).padStart(2, '0')}.jpg`).toString('base64');
    const res = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content: [
        { type: 'text', text: `这是 Word 手册渲染出的第 ${p} 页（共13页），预期：${EXPECT[p]}。请核对：1) 内容是否符合预期？2) 有无排版缺陷（文字溢出/表格错列/图片压扁变形/空白页/乱码/重复段落）？简洁回答：符合与否 + 缺陷列表，60字内。` },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + img } },
      ]}],
    });
    console.log(`── p${p}: ${(res.choices[0]?.message?.content ?? 'no content').trim()}`);
  }
})().catch(e => { console.error('VLM failed:', e.message); process.exit(1); });
