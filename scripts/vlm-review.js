// VLM 审图：检查声盾界面的视觉质量
const ZAI = require('z-ai-web-dev-sdk').default;
const fs = require('fs');

async function main() {
  const zai = await ZAI.create();
  const img = fs.readFileSync(process.argv[2]).toString('base64');
  const res = await zai.chat.completions.createVision({
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `你是资深 UI/UX 评审。这是"声盾"AI语音鉴伪平台的答辩演示界面（深色安全运营风格）。请评审：
1. 有没有明显的视觉缺陷（错位、文字溢出、空白块、组件重叠、乱码）？
2. 环形仪表、红色印章、频谱热力图的观感如何？
3. 作为竞赛答辩演示，第一眼冲击力打几分（1-10）？最弱的一环是什么？
请简洁回答，中文，不超过 200 字。`,
          },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } },
        ],
      },
    ],
  });
  console.log(res.choices[0]?.message?.content ?? 'no content');
}

main().catch((e) => { console.error('VLM failed:', e.message); process.exit(1); });
