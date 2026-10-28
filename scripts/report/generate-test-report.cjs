/**
 * 声盾系统测试报告 — 主装配脚本
 * 三节结构：封面（无页码）/ 前置（摘要+目录，罗马页码）/ 正文（阿拉伯页码从1起）
 * 数据来源：calibration/testsuite_results.json（210 条真实判决）
 */
const {
  Document, Packer, Paragraph, TextRun, Header, Footer,
  AlignmentType, PageNumber, NumberFormat, SectionType,
  TableOfContents, BorderStyle,
} = require("docx");
const fs = require("fs");

const { buildCoverR1 } = require("./cover.cjs");
const { PAL } = require("./builders.cjs");
const part1 = require("./test-content-part1.cjs");
const part2 = require("./test-content-part2.cjs");
const part3 = require("./test-content-part3.cjs");

const OUT = "/home/z/my-project/download/\u58f0\u76fe-\u7cfb\u7edf\u6d4b\u8bd5\u62a5\u544a.docx";

// ============ 封面配置（与技术报告同一视觉体系：声盾安全绿） ============
const coverConfig = {
  title: "\u58f0\u76fe\u7cfb\u7edf\u6d4b\u8bd5\u62a5\u544a",
  subtitle: "\u9762\u5411AI\u8bed\u97f3\u8bc8\u9a97\u7684\u5b9e\u65f6\u9274\u4f2a\u53cd\u8bc8\u5e73\u53f0 \u00b7 \u5168\u56fd\u5927\u5b66\u751f\u4fe1\u606f\u5b89\u5168\u7ade\u8d5b\u4f5c\u54c1\u8d5b",
  englishLabel: "SHIELDEAR SYSTEM TEST REPORT",
  metaLines: [
    "\u88ab\u6d4b\u7248\u672c\uff1aShieldEar v1.3.0-calibrated",
    "\u53c2\u8d5b\u5355\u4f4d\uff1a\u3010\u5b66\u6821 / \u5b66\u9662\u540d\u79f0\u3011",
    "\u56e2\u961f\u6210\u5458\uff1a\u3010\u6210\u5458\u59d3\u540d\uff0c\u591a\u4eba\u4ee5\u987f\u53f7\u5206\u9694\u3011",
    "\u6307\u5bfc\u6559\u5e08\uff1a\u3010\u6307\u5bfc\u6559\u5e08\u59d3\u540d\u3011",
    "\u6d4b\u8bd5\u65e5\u671f\uff1a2026 \u5e74 10 \u6708",
  ],
  footerLeft: "ShieldEar \u00b7 Voice Anti-Fraud Platform",
  footerRight: "TEST-SUITE V1.0 \u00b7 2026.10",
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
        text: "\u58f0\u76fe\uff1a\u9762\u5411AI\u8bed\u97f3\u8bc8\u9a97\u7684\u5b9e\u65f6\u9274\u4f2a\u53cd\u8bc8\u5e73\u53f0 \u00b7 \u7cfb\u7edf\u6d4b\u8bd5\u62a5\u544a",
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
      text: "\u76ee  \u5f55", bold: true, size: 32,
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
      text: "\u6ce8\uff1a\u672c\u76ee\u5f55\u7531\u57df\u4ee3\u7801\u751f\u6210\u3002\u7f16\u8f91\u6587\u6863\u540e\uff0c\u8bf7\u5728\u76ee\u5f55\u4e0a\u70b9\u51fb\u53f3\u952e\u5e76\u9009\u62e9\u300c\u66f4\u65b0\u57df\u300d\u4ee5\u5237\u65b0\u9875\u7801\u3002",
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
  ...part2.chapter6(),
  ...part3.chapter7(),
  ...part3.chapter8(),
  ...part3.chapter9(),
  ...part3.appendix(),
];

// ============ 文档 ============
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  creator: "\u58f0\u76fe ShieldEar \u56e2\u961f",
  title: "\u58f0\u76fe\u7cfb\u7edf\u6d4b\u8bd5\u62a5\u544a",
  description: "\u5168\u56fd\u5927\u5b66\u751f\u4fe1\u606f\u5b89\u5168\u7ade\u8d5b\u4f5c\u54c1\u8d5b \u00b7 \u7cfb\u7edf\u6d4b\u8bd5\u62a5\u544a",
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
    {
      properties: {
        page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      },
      children: buildCoverR1(coverConfig),
    },
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      headers: { default: bodyHeader() },
      footers: { default: pageFooter() },
      children: frontMatter,
    },
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
