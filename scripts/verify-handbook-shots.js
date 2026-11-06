// verify-handbook-shots.js — 用 VLM 核对手册截图内容是否符合预期
const ZAI = require('z-ai-web-dev-sdk').default;
const fs = require('fs');

const SHOT = '/home/z/my-project/download/handbook-shots';

const CHECKS = [
  ['01-home.png', '声盾开屏首页', [
    '顶部导航是否含「检测工作台/案例库/技术方案/系统自检」',
    '是否有 Hero 声纹律动条（绿/青色律动柱）与「SHIELDEAR ENGINE」角标',
    '是否有「答辩演示动线（3 步）」小卡片',
    '是否有三个页签：实时鉴听/文件检测/合成挑战',
  ]],
  ['03-verdict.png', '合成挑战检测结果页', [
    '是否能看到环形置信度仪表（圆环+百分数）',
    '是否有判决文字（如 深伪检出/疑似合成/存在可疑/真人语音 之一）',
    '页面整体是否是合成挑战页（含话术文本框或播放器或结果卡）',
    '有没有明显加载中/报错/空白状态',
  ]],
  ['03b-spectrogram.png', '时频取证视图', [
    '是否有「时频分析 · 取证视图」卡片标题',
    '是否有频谱热力图（彩色瀑布图，含红色可疑区段）',
    '是否有播放器控件',
  ]],
  ['04-cases.png', '案例库列表页', [
    '是否有案例表格/卡片，含 SS- 开头案号',
    '是否有风险等级标签（LOW/HIGH/CRITICAL 彩色徽章）',
    '大约能看到几条案例',
  ]],
];

async function main() {
  const zai = await ZAI.create();
  for (const [file, label, questions] of CHECKS) {
    const img = fs.readFileSync(`${SHOT}/${file}`).toString('base64');
    const res = await zai.chat.completions.createVision({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `这是「声盾」AI语音鉴伪平台界面截图，预期内容：${label}。请逐项核对以下问题，每项回答 是/否 + 一句说明：
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}
最后给出：整体结论（合格/不合格）与任何明显视觉缺陷（错位/溢出/乱码/空白块）。中文回答，200字内。` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } },
        ],
      }],
    });
    console.log(`\n══ ${file}（${label}）══`);
    console.log(res.choices[0]?.message?.content ?? 'no content');
  }
}

main().catch((e) => { console.error('VLM failed:', e.message); process.exit(1); });
