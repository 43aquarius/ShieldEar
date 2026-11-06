const ZAI = require('z-ai-web-dev-sdk').default;
const fs = require('fs');
const PAGES = [1, 2, 4, 6, 7, 8, 12];
const EXPECT = {
  1: '深色封面页：标题「声盾答辩演示手册」、副标题含 v1.3.7、队名与日期',
  2: '目录页（罗马页码）：列出一~六章',
  4: '演示剧本页：应含首页截图（深色界面含绿色声纹律动）',
  6: '应含时频取证瀑布热力图截图（图 3）',
  7: '应含案例库截图（图 4，4 条 SS- 案例）',
  8: '关键数字速查卡大表格（表 2）',
  12: '附录表格页（特性/断网实测明细），文档最后一页',
};
(async () => {
  const zai = await ZAI.create();
  for (const p of PAGES) {
    const img = fs.readFileSync(`/tmp/render/page-${String(p).padStart(2, '0')}.jpg`).toString('base64');
    const res = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content: [
        { type: 'text', text: `这是 Word 手册渲染出的第 ${p} 页，预期：${EXPECT[p]}。请核对：1) 内容是否符合预期？2) 有无排版缺陷（文字溢出/表格错列/图片压扁变形/空白页/乱码/重复段落）？简洁回答：符合与否 + 缺陷列表，60字内。` },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + img } },
      ]}],
    });
    console.log(`── p${p}: ${(res.choices[0]?.message?.content ?? 'no content').trim()}`);
  }
})().catch(e => { console.error('VLM failed:', e.message); process.exit(1); });
