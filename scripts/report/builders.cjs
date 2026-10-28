/**
 * 声盾技术报告 — 正文构建器（Profile A 正式规范）
 */
const {
  Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
} = require("docx");
const fs = require("fs");
const path = require("path");

// 声盾配色（正文用浅色底、深色字；封面另用深色板）
const PAL = {
  primary: "0F2419",
  body: "1A2420",
  secondary: "5C6E64",
  accent: "0E9F6E",
  surface: "F2F7F4",
  headerFill: "E7F2EC",
  tableBorder: "9CC5AF",
  innerBorder: "D5E5DC",
};

const ASSETS = "/home/z/my-project/download/assets";

/** PNG 尺寸解析（IHDR） */
function pngSize(file) {
  const d = fs.readFileSync(file);
  return { width: d.readUInt32BE(16), height: d.readUInt32BE(20) };
}

/** H1 章标题 */
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 380, lineRule: "atLeast" },
    children: [new TextRun({ text, bold: true, size: 32, color: PAL.primary,
      font: { ascii: "Times New Roman", eastAsia: "SimHei" } })],
  });
}

/** H2 节标题 */
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120, line: 350, lineRule: "atLeast" },
    children: [new TextRun({ text, bold: true, size: 30, color: PAL.primary,
      font: { ascii: "Times New Roman", eastAsia: "SimHei" } })],
  });
}

/** H3 小节标题 */
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100, line: 330, lineRule: "atLeast" },
    children: [new TextRun({ text, bold: true, size: 28, color: PAL.primary,
      font: { ascii: "Times New Roman", eastAsia: "SimHei" } })],
  });
}

/** 正文段（两字符缩进、两端对齐、1.3 倍行距） */
function p(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [new TextRun({
    text, size: 24, color: PAL.body,
    font: { ascii: "Times New Roman", eastAsia: "SimSun" },
  })];
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 312, after: opts.after ?? 60 },
    children: runs,
  });
}

/** 强调 run */
function run(text, o = {}) {
  return new TextRun({
    text, size: o.size ?? 24, bold: o.bold ?? false, color: o.color ?? PAL.body,
    font: { ascii: "Times New Roman", eastAsia: o.hei ? "SimHei" : "SimSun" },
  });
}

/** 无缩进说明段（图表脚注等） */
function note(text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { line: 280, before: 40, after: 160 },
    children: [new TextRun({ text, size: 18, color: PAL.secondary,
      font: { ascii: "Times New Roman", eastAsia: "SimSun" } })],
  });
}

/** 图表标题（keepNext 与图绑定） */
function figTitle(text) {
  return new Paragraph({
    keepNext: true,
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text, bold: true, size: 21, color: PAL.body,
      font: { ascii: "Times New Roman", eastAsia: "SimHei" } })],
  });
}

/** 表格标题（keepNext 与表绑定） */
function tabTitle(text) {
  return new Paragraph({
    keepNext: true,
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 21, color: PAL.body,
      font: { ascii: "Times New Roman", eastAsia: "SimHei" } })],
  });
}

/** 插图（保持纵横比） */
function figure(file, displayWidth, caption) {
  const full = path.join(ASSETS, file);
  const { width, height } = pngSize(full);
  const w = displayWidth;
  const h = Math.round(w * height / width);
  const items = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 40 },
      children: [new ImageRun({ data: fs.readFileSync(full), transformation: { width: w, height: h }, type: "png" })],
    }),
  ];
  if (caption) items.push(note(caption));
  return items;
}

/** 数据表（百分比列宽、表头重复、行不跨页拆分） */
function table(headers, rows, widths, opts = {}) {
  const cellMargins = { top: 70, bottom: 70, left: 110, right: 110 };
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: headers.map((text, i) => new TableCell({
      children: [new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { line: 280 },
        children: [new TextRun({ text, bold: true, size: 20, color: PAL.primary,
          font: { ascii: "Times New Roman", eastAsia: "SimHei" } })],
      })],
      shading: { type: ShadingType.CLEAR, fill: PAL.headerFill },
      margins: cellMargins,
      width: { size: widths[i], type: WidthType.PERCENTAGE },
    })),
  });
  const dataRows = rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((text, i) => new TableCell({
      children: [new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { line: 280 },
        children: [new TextRun({
          text: String(text), size: 20,
          bold: !!(opts.boldCol0 && i === 0),
          color: PAL.body,
          font: { ascii: "Times New Roman", eastAsia: "SimSun" },
        })],
      })],
      shading: opts.zebra && ri % 2 === 1
        ? { type: ShadingType.CLEAR, fill: PAL.surface }
        : undefined,
      margins: cellMargins,
      width: { size: widths[i], type: WidthType.PERCENTAGE },
    })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: PAL.tableBorder },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: PAL.tableBorder },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: PAL.innerBorder },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: PAL.innerBorder },
    },
    rows: [headerRow, ...dataRows],
  });
}

module.exports = { PAL, h1, h2, h3, p, run, note, figTitle, tabTitle, figure, table };
