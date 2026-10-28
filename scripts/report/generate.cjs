/**
 * 声盾参赛技术报告 — 主装配脚本
 * 三节结构：封面（无页码）/ 前置（摘要+目录，罗马页码）/ 正文（阿拉伯页码从1起）
 */
const {
  Document, Packer, Paragraph, TextRun, Header, Footer,
  AlignmentType, HeadingLevel, PageNumber, NumberFormat, SectionType,
  TableOfContents, PageBreak, BorderStyle,
} = require("docx");
const fs = require("fs");

const { buildCoverR1 } = require("./cover.cjs");
const { PAL } = require("./builders.cjs");
const part1 = require("./content-part1.cjs");
const part2 = require("./content-part2.cjs");
const part3 = require("./content-part3.cjs");

const OUT = "/home/z/my-project/download/声盾-参赛技术报告.docx";

// ============ 封面配置（声盾安全绿配色） ============
const coverConfig = {
  title: "声盾：面向AI语音诈骗的实时鉴伪反诈平台",
  subtitle: "全国大学生信息安全竞赛作品赛 · 参赛技术报告",
  englishLabel: "SHIELDEAR TECHNICAL REPORT",
  metaLines: [
    "参赛类别：应用安全（内容安全）",
    "参赛队伍：你们说的对",
    "参赛单位：大连理工大学",
    "团队成员：谭畅 等 2 人",
    "开源仓库：github.com/43aquarius/ShieldEar",
    "完成日期：2026 年 10 月",
  ],
  footerLeft: "ShieldEar · Voice Anti-Fraud Platform",
  footerRight: "V1.3 · 2026.10",
  palette: {
    bg: "0A1410",
    titleColor: "E8F5EE",
    subtitleColor: "9CC5AF",
    metaColor: "8FB8A3",
    accent: "34D399",
    footerColor: "5F8A75",
  },
};

// ============ 页眉 / 页脚 ============
function bodyHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: PAL.innerBorder, space: 4 } },
      children: [new TextRun({
        text: "声盾：面向AI语音诈骗的实时鉴伪反诈平台 · 参赛技术报告",
        size: 18, color: "808080",
        font: { ascii: "Times New Roman", eastAsia: "SimSun" },
      })],
    })],
  });
}

function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080" })],
    })],
  });
}

// ============ 前置节（摘要 + 目录） ============
const frontMatter = [
  ...part1.abstractSection(),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 480, after: 360 },
    children: [new TextRun({
      text: "目  录", bold: true, size: 32,
      font: { eastAsia: "SimHei", ascii: "Times New Roman" },
    })],
  }),
  new TableOfContents("Table of Contents", {
    hyperlink: true,
    headingStyleRange: "1-2",
  }),
  new Paragraph({
    spacing: { before: 200 },
    children: [new TextRun({
      text: "注：本目录由域代码生成。编辑文档后，请在目录上点击右键并选择「更新域」以刷新页码。",
      italics: true, size: 18, color: "888888",
      font: { ascii: "Times New Roman", eastAsia: "SimSun" },
    })],
  }),
];

// ============ 正文 ============
const body = [
  ...part1.chapter1(),
  ...part1.chapter2(),
  ...part1.chapter3(),
  ...part2.chapter4(),
  ...part2.chapter5(),
  ...part3.chapter6(),
  ...part3.chapter7(),
  ...part3.chapter8(),
  ...part3.chapter9(),
  ...part3.appendix(),
];

// ============ 文档 ============
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  creator: "声盾 ShieldEar 团队",
  title: "声盾：面向AI语音诈骗的实时鉴伪反诈平台 · 参赛技术报告",
  description: "全国大学生信息安全竞赛作品赛参赛技术报告",
  styles: {
    default: {
      document: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimSun" }, size: 24, color: "000000" },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 32, bold: true, color: PAL.primary },
        paragraph: { spacing: { before: 360, after: 160, line: 380 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 30, bold: true, color: PAL.primary },
        paragraph: { spacing: { before: 260, after: 120, line: 350 }, outlineLevel: 1 },
      },
      heading3: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 28, bold: true, color: PAL.primary },
        paragraph: { spacing: { before: 200, after: 100, line: 330 }, outlineLevel: 2 },
      },
    },
  },
  sections: [
    // 节1：封面（边距为0，无页眉页脚页码）
    {
      properties: {
        page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      },
      children: buildCoverR1(coverConfig),
    },
    // 节2：前置（摘要+目录，罗马页码）
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      headers: { default: bodyHeader() },
      footers: { default: pageFooter() },
      children: frontMatter,
    },
    // 节3：正文（阿拉伯页码从1起）
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: bodyHeader() },
      footers: { default: pageFooter() },
      children: body,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("written:", OUT, buf.length, "bytes");
});
