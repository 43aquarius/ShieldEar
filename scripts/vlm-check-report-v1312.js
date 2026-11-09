const ZAI = require('z-ai-web-dev-sdk').default;
const fs = require('fs');
const PAGES = [1, 2, 9, 15, 19, 26, 32];
const EXPECT = {
  1: '深绿色调封面页：标题「声盾：面向AI语音诈骗的实时鉴伪反诈平台」、参赛技术报告、元信息含 V1.3.12 · 2026.11',
  2: '摘要页（罗马页码 II 附近）：正文含「十一维」「v2.0.0-calibrated」等，排版无溢出',
  9: '学术对比表页：表 2-1 六列（维度/CQCC/RawNet2/AASIST/单类学习/声盾v2.0），单元格文字不溢出、不串列',
  15: '表 4-1 十一维特征定义表（四列），行完整不截断',
  19: '图 5-1 特征分离度条形图（11 个特征 × 宽带/窄带双色），中文标签正常渲染',
  26: '参考文献页：15 条 GB/T 7714 格式条目，悬挂缩进整齐，中英文混排无乱码',
  32: '附录B 表 B-1 开源组件映射表 + 注释，文档最后一页，无空白尾页',
};
(async () => {
  const zai = await ZAI.create();
  for (const p of PAGES) {
    const img = fs.readFileSync(`/tmp/render/pg-${String(p).padStart(2, '0')}.jpg`).toString('base64');
    const res = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content: [
        { type: 'text', text: `这是参赛技术报告渲染出的第 ${p} 页，预期：${EXPECT[p]}。请核对：1) 内容是否符合预期？2) 有无排版缺陷（文字溢出/表格错列或过挤/图片压扁变形/空白页/乱码/重复段落）？简洁回答：符合与否 + 缺陷列表，80字内。` },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + img } },
      ]}],
    });
    console.log(`── p${p}: ${(res.choices[0]?.message?.content ?? 'no content').trim()}`);
  }
})().catch(e => { console.error('VLM failed:', e.message); process.exit(1); });
