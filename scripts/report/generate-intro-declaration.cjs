/**
 * 声盾 — 作品简介 + 参赛作品声明（两份短文档，无封面无目录，阿拉伯页码）
 */
const {
  Document, Packer, Paragraph, TextRun, Header, Footer,
  AlignmentType, PageNumber, BorderStyle,
} = require("docx");
const fs = require("fs");
const { PAL, h2, p, run, note, tabTitle, table } = require("./builders.cjs");

const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080" })],
    })],
  });
}

function docTitle(text, subtitle) {
  const items = [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 120, line: 500, lineRule: "atLeast" },
    children: [new TextRun({
      text, bold: true, size: 36, color: PAL.primary,
      font: { ascii: "Times New Roman", eastAsia: "SimHei" },
    })],
  })];
  if (subtitle) {
    items.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: PAL.accent, space: 10 } },
      children: [new TextRun({
        text: subtitle, size: 22, color: PAL.secondary,
        font: { ascii: "Times New Roman", eastAsia: "SimHei" },
      })],
    }));
  }
  return items;
}

// ============ 文档一：作品简介 ============
function buildIntro() {
  const children = [
    ...docTitle("声盾（ShieldEar）作品简介",
      "面向 AI 语音诈骗的实时鉴伪反诈平台"),
    p([
      run("声盾（ShieldEar）是一个运行于浏览器与服务器的实时 AI 语音鉴伪与反诈取证平台，回答一个当下反诈治理中最直接的问题：普通人接到可疑电话时，如何知道对方的声音是不是 AI 合成的。用户开启实时鉴听或上传语音文件，声盾在通话过程中逐秒输出合成置信度，发现伪造片段立即告警，通话结束后自动生成含时间轴定位、音频哈希存证与处置建议的可打印核验报告，形成「检测—告警—存证—报告」的反诈业务闭环。"),
    ]),
    tabTitle("作品信息"),
    table(
      ["项目", "内容"],
      [
        ["作品名称", "声盾（ShieldEar）——面向 AI 语音诈骗的实时鉴伪反诈平台"],
        ["参赛队伍", "你们说的对（大连理工大学）· 队长 43aquarius · 队员 谭畅"],
        ["参赛类别", "应用安全（内容安全），兼具安全检测与数据安全（存证）能力"],
        ["关键词", "AI 语音诈骗 · 实时流式鉴伪 · 声学特征 · 反诈存证 · 试听体系"],
        ["软件版本", "ShieldEar v1.3.0-calibrated"],
        ["开发形态", "Web 单页应用（Next.js 16 + React 19），同构 TypeScript 引擎双端运行"],
        ["开源仓库", "https://github.com/43aquarius/ShieldEar"],
      ],
      [22, 78]
    ),
    h2("核心功能"),
    p([
      run("平台包含五大功能模块：实时鉴听（麦克风流采集，波形与逐窗置信度曲线同屏呈现，高风险告警脉冲提示）；文件检测（拖拽即测，输出判决与可解释的八维声学特征剖面）；现场合成挑战（页面内调用合成引擎即时生成对照样本并自检，答辩现场可演示完整闭环）；案例库与证据链（历史检测案件检索、WAV 证据下载、双哈希校验）；可打印核验报告（八章节取证材料，可作 96110 举报与取证附件）。全部功能在单页应用内零跳转完成。"),
    ]),
    h2("技术方案概要"),
    p([
      run("检测引擎为纯 TypeScript 实现的滑动窗口流式管线（2 秒窗口 / 1 秒步进、五成重叠），逐窗提取八维面向神经声码器指纹的声学特征（谐波规整度、谱通量波动度、高频周期性、基音微扰等），经数据驱动校准（类加权 L2 逻辑回归）得到决策权重，并针对 300–3400 Hz 电话窄带信道单独拟合权重组。判决采用中值滤波叠加指数平滑与能量加权聚合，输出四级风险分级；不确定样本显式标注而非硬判。同一份引擎代码在浏览器（初判）与服务端（复核）运行，双端判决一致与存证可复现由同构架构保证；音频与检测结果均以 SHA-256 哈希入库存证。"),
    ]),
    h2("关键指标（实测）"),
    tabTitle("核心指标一览（详见系统测试报告）"),
    table(
      ["指标", "实测结果"],
      [
        ["宽带检出率（合成样本 20/20）", "100%"],
        ["窄带（电话信道）检出率", "80%（16/20）"],
        ["告警精确率（宽带 / 窄带）", "0.935 / 0.921"],
        ["单窗（2 秒）分析时延", "P99 仅 9.15 毫秒（纯 CPU）"],
        ["到屏判决时延", "≤ 1.01 秒"],
        ["整段分析实时因子 RTF", "中位数 0.0064，距实时线两个数量级"],
        ["端到端功能测试", "8/8 用例全部通过"],
      ],
      [55, 45]
    ),
    h2("主要创新点"),
    p([
      run("第一，从离线检测到通话级实时流式鉴伪：以滑动窗口管线实现边通话边检测，到屏判决时延不超过约 1 秒，与既有离线检测类获奖作品形成代际差异。第二，可解释轻量引擎与数据驱动校准：每个判决可追溯到八维特征剖面，校准集上实测证伪并剔除了无效特征（高频谱平坦度权重趋零）。第三，反诈业务闭环：检测、告警、双哈希存证、可打印取证报告全链路自动化，面向 96110 举报与反诈核查场景。第四，双端同构一致性存证：浏览器与服务器运行同一份引擎代码，为司法取证提供可复现的工程基础。"),
    ]),
    h2("应用前景"),
    p([
      run("面向公众，声盾可作为接听可疑电话时的验真入口，在转账、汇款前提供一道声学上的风险提示；面向机构，可作为银行客服、电商平台风控环节的语音风险筛查组件与司法协查的存证工具；面向监管，其存证链路与核验报告可直接服务于《反电信网络诈骗法》与《深度合成管理规定》落地后的执法取证需求。后续将按两阶段路线接入深度检测模型交叉验证，并在 ASVspoof 系列公开数据集上补充标准化评测。"),
    ]),
    h2("作品资料与可复现"),
    p([
      run("作品交付物包括：免安装可执行程序包（内置运行时，双击即用）、可运行的 Web 平台全部源码（GitHub 开源仓库 https://github.com/43aquarius/ShieldEar）、系统设计报告、系统测试报告、参赛作品声明与答辩演示材料。全部测试结论可通过仓库内测试管线（固定种子的变体生成与自动化评测脚本）一键复现，逐条判决明细随仓库提供；可执行程序包内代码与仓库主干一致，评审可对照复核。指导教师信息见技术报告封面。"),
    ]),
  ];
  return new Document({
    creator: "声盾 ShieldEar 团队",
    title: "声盾（ShieldEar）作品简介",
    styles: {
      default: {
        document: {
          run: { font: { ascii: "Times New Roman", eastAsia: "SimSun" }, size: 24, color: "000000" },
          paragraph: { spacing: { line: 312 } },
        },
      },
    },
    sections: [{
      properties: { page: { size: pgSize, margin: pgMargin } },
      footers: { default: pageFooter() },
      children,
    }],
  });
}

// ============ 文档二：参赛作品声明 ============
function buildDeclaration() {
  const sec = (text) => p([run(text)]);
  const children = [
    ...docTitle("参赛作品声明",
      "声盾（ShieldEar）——面向 AI 语音诈骗的实时鉴伪反诈平台"),
    p([
      run("本声明适用于本团队（参赛队伍：你们说的对 · 大连理工大学）参加全国大学生信息安全竞赛作品赛的参赛作品「声盾（ShieldEar）——面向 AI 语音诈骗的实时鉴伪反诈平台」（以下简称「本作品」），就作品版权、原创性、技术公开与数据合规事项声明如下。"),
    ]),
    h2("一、原创性声明"),
    sec("本作品的检测引擎（含 DSP 工具库、八维声学特征提取、数据驱动校准与滑动窗口流式分析管线）、Web 平台（实时鉴听、文件检测、现场合成挑战、案例库、核验报告等全部功能模块）、存证与证据链路、测试套件与本次参赛全部文档（系统设计报告、系统测试报告、作品简介等）均为本团队独立设计、开发与撰写。作品中未抄袭、剪切或套用任何已发表的参赛作品、论文或他人未公开成果；若存在与其他作品的相似之处，均属于公开技术领域的通用常见实现。本团队对上述声明的真实性负法律责任。"),
    h2("二、版权归属声明"),
    sec("本作品的著作权、软件代码及其修改权、文档与图表等相关权利均归属作品完成人（参赛团队成员及其所属单位按竞赛规章约定）。未经作品完成人书面许可，任何单位或个人不得将本作品全部或部分用于商业用途、申报其他奖项或以其他方式转让、许可第三方使用。"),
    h2("三、开源组件使用声明"),
    sec("本作品工程实现建立在开源生态之上，使用了 Next.js、React、Tailwind CSS、shadcn/ui、Prisma、recharts 等开源框架与组件，均按其原始开源许可证（MIT、Apache-2.0 等）使用并保留原始版权与许可声明；检测引擎本身（特征提取、评分与流式分析管线）为本团队从零实现的原创代码，未引用任何第三方检测模型与权重。开源组件的完整映射清单见系统设计报告附录。"),
    h2("四、技术公开声明"),
    sec("为满足竞赛对作品可执行程序与可复现性的评审要求，本团队将本作品源码与文档托管至 GitHub 开源仓库（https://github.com/43aquarius/ShieldEar）并向竞赛组织方开放查阅权限，同时随作品提交免安装可执行程序包；涉及本作品的核心算法、实现细节与实验数据均如实公开于仓库与文档，不含任何未公开的保密算法或技术秘密。作品中引用的第三方开源组件均为其公开发布版本，未包含任何未经授权的代码或模型。"),
    h2("五、数据合规声明"),
    sec("本作品测试与校准所用音频样本均来自公开渠道：自然人声样本取自 wavesurfer.js 与 MDN 公开演示音频及公有领域（LibriVox）有声书；合成样本由授权 TTS 服务生成。全部样本不含可识别特定自然人的个人信息，不涉及个人信息与生物识别信息保护相关法律义务；平台用户产生的检测记录与证据仅存储于用户自部署的数据库中，不上传任何第三方服务器。"),
    h2("六、其他"),
    sec("本团队已充分知晓并自愿遵守大赛组织方关于参赛作品的各项规章和办法，包括但不限于作品原创性审查、知识产权宣示等环节；如组织方对本声明中任何事项有异议，本团队愿意配合提交补充证明材料并接受组织方的处理决定。"),
    new Paragraph({ spacing: { before: 400 } }),
    p([
      run("作品完成人（参赛团队全体成员）签字：", { bold: true }),
    ]),
    p([
      run("队长 43aquarius：＿＿＿＿＿＿＿＿＿＿　　　队员 谭畅：＿＿＿＿＿＿＿＿＿＿"),
    ]),
    p([
      run("指导教师签字：", { bold: true }),
    ]),
    p([
      run("【指导教师签名】"),
    ]),
    p([
      run("声明日期：", { bold: true }),
      run("2026 年 10 月　日"),
    ]),
  ];
  return new Document({
    creator: "声盾 ShieldEar 团队",
    title: "声盾参赛作品声明",
    styles: {
      default: {
        document: {
          run: { font: { ascii: "Times New Roman", eastAsia: "SimSun" }, size: 24, color: "000000" },
          paragraph: { spacing: { line: 312 } },
        },
      },
    },
    sections: [{
      properties: { page: { size: pgSize, margin: pgMargin } },
      footers: { default: pageFooter() },
      children,
    }],
  });
}

Packer.toBuffer(buildIntro()).then((buf) => {
  fs.writeFileSync("/home/z/my-project/download/声盾-作品简介.docx", buf);
  console.log("written: 声盾-作品简介.docx", buf.length, "bytes");
});
Packer.toBuffer(buildDeclaration()).then((buf) => {
  fs.writeFileSync("/home/z/my-project/download/声盾-参赛作品声明.docx", buf);
  console.log("written: 声盾-参赛作品声明.docx", buf.length, "bytes");
});
