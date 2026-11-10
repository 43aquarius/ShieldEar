/**
 * gen-demo-handbook.js — 声盾 v1.3.15 答辩演示手册生成器（v1.3.8 附录历史实录保留）
 * 架构：R1 封面（深翠暗底）→ 目录节（罗马页码）→ 正文节（阿拉伯页码从 1 起）
 * 字体：Profile A（SimHei 标题 / SimSun 正文 / TNR 西文）
 * 截图：PNG 头读取尺寸，等比缩放嵌入（download/handbook-shots/，2026-11-06 实拍）
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, PageBreak, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, SectionType, LevelFormat, TableOfContents,
} = require("docx");
const fs = require("fs");

const OUT = "/home/z/my-project/download/声盾-答辩演示手册.docx";
// 截图源：优先本地实拍目录（take-handbook-shots.sh 产物），回退到随库 docs/handbook-shots
const SHOT = fs.existsSync("/home/z/my-project/download/handbook-shots/01-home.png")
  ? "/home/z/my-project/download/handbook-shots"
  : "/home/z/my-project/docs/handbook-shots";

/* ───────── 调色板 ───────── */
const COVER = {
  bg: "0C1712", titleColor: "EDF7F1", subtitleColor: "9DBFAC",
  metaColor: "C4DCCF", accent: "2FBF8F", footerColor: "6E8F7D",
};
const P = {
  primary: "0E2A1E", body: "000000", secondary: "5C6F66",
  accent: "0E9F6E", surface: "EAF4EE", line: "8FB3A2",
  headFill: "DCEDE3",
};

const allNoBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
  insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
};
const noBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
};

/* ───────── 封面工具函数（design-system 标准实现） ───────── */
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."，。、；：！？", ..."的与和及之在于为", ..."-_—–·/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) {
      breakAt = charsPerLine;
      const prevChar = remaining[breakAt - 1], nextChar = remaining[breakAt];
      if (prevChar && nextChar && !breakAfter.has(prevChar) && !breakAfter.has(nextChar) &&
          /[\u4e00-\u9fff]/.test(prevChar) && /[\u4e00-\u9fff]/.test(nextChar)) breakAt -= 1;
    }
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / (pt * 20));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}
function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0,
  } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const safeRemaining = Math.max(usableHeight - contentHeight, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

/* ───────── R1 封面 ───────── */
function buildCoverR1(config) {
  const C = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: C.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "),
        size: 18, color: C.accent, font: { ascii: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true,
        color: C.titleColor, font: { eastAsia: "SimHei", ascii: "Arial" } })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: C.subtitleColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 24, color: C.metaColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: C.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: C.footerColor, font: { ascii: "Arial" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: C.bg }, borders: noBorders,
        children,
      })],
    })],
  })];
}

/* ───────── 正文构件 ───────── */
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER,
    spacing: { before: 400, after: 200, line: 380, lineRule: "atLeast" },
    children: [new TextRun({ text, bold: true, size: 32, color: P.primary,
      font: { eastAsia: "SimHei", ascii: "Times New Roman" } })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 140, line: 350, lineRule: "atLeast" },
    children: [new TextRun({ text, bold: true, size: 28, color: P.primary,
      font: { eastAsia: "SimHei", ascii: "Times New Roman" } })],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 312, after: opts.after != null ? opts.after : 80 },
    children: [new TextRun({ text, size: 24, color: P.body,
      font: { eastAsia: "SimSun", ascii: "Times New Roman" } })],
  });
}
function quote(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { left: 360, right: 240 },
    spacing: { line: 312, before: 100, after: 140 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: P.accent, space: 10 } },
    children: [new TextRun({ text, size: 24, color: "1F4433",
      font: { eastAsia: "KaiTi", ascii: "Times New Roman" } })],
  });
}
function listItem(ref, text) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    alignment: AlignmentType.LEFT,
    spacing: { line: 312, after: 40 },
    children: [new TextRun({ text, size: 24, color: P.body,
      font: { eastAsia: "SimSun", ascii: "Times New Roman" } })],
  });
}
function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 200 },
    children: [new TextRun({ text, size: 21, color: P.secondary,
      font: { eastAsia: "SimSun", ascii: "Times New Roman" } })],
  });
}
function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function shot(file, displayWidth = 540) {
  const buf = fs.readFileSync(`${SHOT}/${file}`);
  const { w, h } = pngSize(buf);
  const dh = Math.round(displayWidth * h / w);
  return new Paragraph({
    alignment: AlignmentType.CENTER, keepNext: true,
    spacing: { before: 120 },
    children: [new ImageRun({ data: buf, transformation: { width: displayWidth, height: dh }, type: "png" })],
  });
}
function cell(text, opts = {}) {
  return new TableCell({
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      spacing: { line: 300 },
      children: [new TextRun({ text, bold: !!opts.bold, size: opts.size || 21,
        color: opts.color || P.body,
        font: { eastAsia: opts.hei ? "SimHei" : "SimSun", ascii: "Times New Roman" } })],
    })],
    shading: { type: ShadingType.CLEAR, fill: opts.fill || "FFFFFF" },
    margins: { top: 70, bottom: 70, left: 120, right: 120 },
    width: { size: opts.w || 25, type: WidthType.PERCENTAGE },
    verticalAlign: "top",
  });
}
function dataTable(headers, rows, widths) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: P.line },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: P.line },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "CBD9D0" },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headers.map((t, i) => cell(t, { bold: true, hei: true, fill: P.headFill, w: widths[i], color: P.primary })),
      }),
      ...rows.map(r => new TableRow({
        cantSplit: true,
        children: r.map((t, i) => cell(t, { w: widths[i] })),
      })),
    ],
  });
}
function tableTitle(text) {
  return new Paragraph({
    keepNext: true, spacing: { before: 160, after: 100 },
    children: [new TextRun({ text, bold: true, size: 21, color: P.primary,
      font: { eastAsia: "SimHei", ascii: "Times New Roman" } })],
  });
}

/* ───────── 正文内容 ───────── */
const bodyChildren = [];

/* ══ 一、演示前检查清单 ══ */
bodyChildren.push(h1("一、演示前检查清单"));
bodyChildren.push(body("本手册面向答辩现场的演示环节，覆盖检查、剧本、数字、应急与问答五个部分。演示使用 v1.3.15 纯离线便携包，全部功能不依赖任何网络（云端合成通道已从发行包整体移除）。建议在正式答辩前一天与当天开场前各执行一次下表检查，逐项确认后打勾。", { after: 120 }));
bodyChildren.push(tableTitle("表 1 演示前检查清单"));
bodyChildren.push(dataTable(
  ["类别", "检查项", "判定标准"],
  [
    ["硬件", "Windows 10/11 笔记本，扬声器外放正常", "能清晰播放合成语音；浏览器为 Edge 或 Chrome 最新版"],
    ["软件", "便携包解压完成后双击 START-ShieldEar.bat", "黑色控制台数秒内完成启动自检并打开首页；包目录无 STARTUP-ERROR.txt（有的话按附录排查）"],
    ["数据", "案例库内置演示案例完整", "表格内有 4 条 SS- 开头案例：2 条真人（LOW）与 2 条 AI 合成（HIGH/CRITICAL）"],
    ["自检", "打开「系统自检」页一键体检", "数据引擎、证据目录、引擎校准、本地合成引擎、离线声明五项全绿"],
    ["合成", "双击包根目录 windows-smoke.cmd", "约 10 秒完成版本探测→中文合成→产物校验，显示 PASS 即健康（v1.3.8 新增；对 v1.3.7 旧包可就地修复 DLL 文件名）"],
    ["备份", "便携包 zip 副本存于 U 盘与队友机器各一份", "文件约 58.1MB，与 GitHub Release v1.3.15 附件一致（SHA-256 见附录）"],
    ["环境", "确认赛场网络状况", "有无网络均可演示：发行包为纯离线版，零联网路径，无需任何切换操作"],
    ["时间", "与主持人确认演示时长", "8 分钟走标准剧本（第二节），5 分钟走精简版动线"],
  ],
  [12, 40, 48]
));
bodyChildren.push(body("特别说明：便携包内置 Node.js 运行时、Windows 版 espeak-ng 离线合成组件与 VC++ 2015-2022 运行库三个 DLL（app-local 随包；v1.3.8 起 libespeak-ng.dll 连字符与 libespeak_ng.dll 下划线双文件名并存，任何 Windows 上合成引擎开箱即用），在 Win10/11 上解压即用，不安装任何软件、不写入注册表、无需预装运行库。若赛场提供 HDMI 与音响，优先外放音频，让评委同时听到与看到检测过程。", { after: 160 }));

/* ══ 二、标准演示剧本 ══ */
bodyChildren.push(h1("二、标准演示剧本（8 分钟版）"));
bodyChildren.push(body("剧本共五幕，每幕给出画面、操作与话术。话术仅是建议口径，可按个人习惯调整，但每幕的数字与结论句建议照读，确保口径与速查卡一致。全剧本的关键节奏是：先让系统开口（合成），再让系统亮剑（判决剧场），最后让证据落地（存证）。", { after: 120 }));

bodyChildren.push(h2("第 1 幕 · 开场与产品定位（约 1 分钟）"));
bodyChildren.push(body("不进行任何操作，让首页动画自己说话。声纹律动条持续起伏，页脚滚动显示引擎版本与实时因子，这本身就是系统活着的证明。"));
bodyChildren.push(shot("01-home.png"));
bodyChildren.push(caption("图 1 开屏首页：Hero 声纹律动与三步演示动线"));
bodyChildren.push(quote("「一通熟悉的声音，可能是 AI 的表演。声盾只回答一个问题：这通电话里的声音，到底是不是 AI 合成的。边通话、边检测、边存证，这三件事同时成立。」"));

bodyChildren.push(h2("第 2 幕 · 现场合成挑战（约 2 分钟）"));
bodyChildren.push(body("切换到「合成挑战」页签，强调文本由评委现场提供，彻底排除预录嫌疑。默认话术模板为冒充亲属求助的高频诈骗话术，也可以请评委即兴输入一段。"));
bodyChildren.push(listItem("ops-s1", "点击顶部「合成挑战」页签，展示话术模板、文本框与音色选择。"));
bodyChildren.push(listItem("ops-s1", "邀请评委修改文本（或不改，直接用默认冒充亲属话术），保持音色为默认的桐桐。"));
bodyChildren.push(listItem("ops-s1", "点击「现场合成并检测」，等待约半秒，播放器出现合成语音。"));
bodyChildren.push(quote("「这段话是评委刚才输入的，不是预录的。服务端当场合成诈骗话术，原始 WAV 与分析副本分别计算 SHA-256 固定，从生成那一刻起就进入证据链。」"));

bodyChildren.push(h2("第 3 幕 · 判决剧场（约 1.5 分钟，全片高光）"));
bodyChildren.push(body("合成完成后自动进入检测结果页，这是全场视觉冲击的顶点：环形置信度仪表逐格点亮、数字滚动收敛，随后判决印章砸落。务必等印章动画落定（约 3 秒）再开口，让画面完整呈现。"));
bodyChildren.push(shot("03-verdict.png"));
bodyChildren.push(caption("图 2 判决剧场：环形置信度仪表、判决印章与统计卡（2026-11-06 实拍，合成置信度 56.7% · HIGH）"));
bodyChildren.push(quote("「置信度 56.7%，判定 HIGH——琥珀色的『疑似合成』印章是给受害者看的，一眼看懂；下面的瀑布图是给鉴定人看的：客户端 FFT 逐帧算出的时频热力，可疑片段在频谱上的位置一目了然。一份判决，两种受众。」"));
bodyChildren.push(shot("03b-spectrogram.png"));
bodyChildren.push(caption("图 3 时频取证视图：1024 点 FFT 瀑布热力图，红色竖线为引擎判定的可疑片段（点击图面可跳转播放）"));

bodyChildren.push(h2("第 4 幕 · 实时鉴听与存证（约 2 分钟）"));
bodyChildren.push(body("切换到「实时鉴听」页签，模拟受害者视角：通话进行中，逐窗判决、检出即告警。外放第 2 幕合成的语音充当通话对端，无需真实麦克风对讲。"));
bodyChildren.push(listItem("ops-s5", "点击「开始鉴听」，授权麦克风后立即外放合成语音。"));
bodyChildren.push(listItem("ops-s5", "观察威胁热力时间线逐窗落格，可疑窗变红，告警横幅滑入。"));
bodyChildren.push(listItem("ops-s5", "点击「结束鉴听」，系统自动固定哈希并生成案号，演示存证包下载。"));
bodyChildren.push(quote("「现在模拟受害者的手机：通话还在进行，每一窗都在判。挂断之前，SHA-256 哈希、案号、时间戳已经生成，存证包可以当场下载、一键转发给反诈专线。」"));

bodyChildren.push(h2("第 5 幕 · 案例库与收尾（约 0.5 分钟）"));
bodyChildren.push(body("切到「案例库」视图，扫一眼彩色风险标签即可收尾，不展开细节。"));
bodyChildren.push(shot("04-cases.png"));
bodyChildren.push(caption("图 4 案例库：每条判决可复核、可导出存证包"));
bodyChildren.push(quote("「每一次检测都是一条可复核的判例。这就是声盾——接起电话的那一刻，给普通人一个可以相信的答案。」"));

bodyChildren.push(h2("5 分钟精简版动线"));
bodyChildren.push(body("时间被压缩时，将第 1 至 3 幕合并为 2.5 分钟（合成后直接讲解判决剧场，省去评委输入环节），第 4 幕实时鉴听保留 1.5 分钟（告警与案号生成是核心记忆点，存证包下载改为口头带过），第 5 幕与收尾话术合并。核心原则：判决剧场与实时鉴听两幕无论多紧张都不删，它们是全部记忆点的所在。", { after: 160 }));

/* ══ 三、关键数字速查卡 ══ */
bodyChildren.push(h1("三、关键数字速查卡"));
bodyChildren.push(body("下表数字全部来自实测。浏览器「文件检测」预置样本与案例库服务端判决是两条独立管线，数字都真实有效，被追问时直接说明口径即可。", { after: 120 }));
bodyChildren.push(tableTitle("表 2 关键数字速查卡（2026 年 11 月实测）"));
bodyChildren.push(dataTable(
  ["指标", "数值", "口径与来源"],
  [
    ["服务端案例判决", "真人 LOW（16.9%/16.0%）；AI CRITICAL 78.7% / HIGH 71.6%", "内置 4 条演示案例（v1.3.15 包内种子，正式管线重灌），服务端同一引擎复核"],
    ["现场合成挑战判决", "HIGH 疑似合成 · 合成置信度约 57%（2026-11-06 实拍口径）", "espeak-ng 本地合成冒充亲属话术，当场合成当场检出；现场以当场输出为准"],
    ["合成检出", "92.5%（37/40）", "校准集 T1 双信道 · 258 判决基线（引擎 v2.1.0-robust）"],
    ["自然语音放行", "0.80（40/50 判决）", "N1 原始 + N2 鲁棒性变体（10 例误判为有声书类，已在边界中披露）"],
    ["宽带 F1", "0.962（Acc 0.938）", "基线 129 文件；窄带 F1 0.876 / 综合 EER 0.18 / AUC 0.925"],
    ["跨引擎独立集", "总体正确率 81.3%", "微软 Edge 神经 TTS，8 音色 × 3 新文本，窄带检出 23/24"],
    ["实时因子 RTF", "峰值 0.015（p50 0.0069 / p95 0.0086）", "纯 TypeScript 引擎 v2.1.0-robust，258 判决实录"],
    ["判决时延", "不超过 1 秒", "滑窗流式管线，2 秒窗 50% 重叠"],
    ["断网功能测试", "基线 8/8 + v1.3.15 专项 11/11", "解压交付 zip 后在 Linux 无外网命名空间（仅 lo 回环）实测：基线八项 + v1.3.15 专项（直流免疫/质量护栏/触发矩阵/安全头/格式闸/特征剖面/并发/存证包/413 等十一项）"],
    ["离线合成兜底", "约 0.23 秒", "本地 espeak-ng，零联网、零尝试、零等待"],
    ["证据完整性核验", "篡改 1 字节立即检出", "服务端重读证据 WAV，重算 SHA-256 与入库值逐项比对"],
    ["便携包体积", "58.1MB（1,361 文件）", "含 Node.js 运行时、espeak-ng（双文件名 DLL）、VC++ 运行库三 DLL 与全部前端资源；较 v1.3.2 官方包 285.9MB 精简约 80%"],
    ["引擎版本", "v2.1.0-robust", "十一维声学特征（声码器指纹×8 + 韵律动态×3），帧级直流免疫 + 输入质量护栏；权重由校准脚本拟合可复现"],
  ],
  [24, 30, 46]
));
bodyChildren.push(body("若评委质疑断网真实性，可当场要求拔掉网线或关闭无线，重新走一遍第 2 幕与第 3 幕：合成照常约 0.2 秒出结果，判决剧场动画完整播放。断网不是退化模式，而是默认模式。", { after: 160 }));

/* ══ 四、应急预案 ══ */
bodyChildren.push(h1("四、应急预案"));
bodyChildren.push(body("六种常见故障场景的应对策略如下表。总体原则：便携包的设计目标就是最坏情况全兜底，任何场景下都有一跳可达的降级路径，不会出现无法演示的死局。", { after: 120 }));
bodyChildren.push(tableTitle("表 3 应急预案"));
bodyChildren.push(dataTable(
  ["故障场景", "应对操作", "口径要点"],
  [
    ["场馆无网络", "无需任何操作，发行包即纯离线版", "强调：断网不是降级，是安全默认；云端通道已从发行包整体移除，接口 403 锁死"],
    ["麦克风不可用或权限被拒", "实时鉴听改为「文件检测」页签上传 WAV，效果等价", "强调双端一致：文件与实时通话跑同一引擎，结论一致是取证可信的基础"],
    ["现场合成变慢或异常", "发行包无任何云端依赖，本地 espeak 约 0.2 秒完成", "先双击包根目录 windows-smoke.cmd 一键定位（v1.3.8 起随包）；若合成组件被杀毒软件误删，预置样本回放自动兜底并如实标注；文件检测与案例库完全不依赖合成链路，可先跳过去再回来"],
    ["浏览器或系统崩溃", "重新双击 START-ShieldEar.bat，30 秒内恢复", "数据在本地 SQLite，已录案例不丢失；期间口头讲解架构图过渡"],
    ["启动自检失败", "查看控制台中文提示与包目录 STARTUP-ERROR.txt", "按提示补齐对应组件；数据引擎与合成引擎相互独立，单一组件缺失不致整包不可用"],
    ["评委中途打断提问", "每幕独立成章，答完从下一幕继续", "回答控制在 30 秒内；不确定的数字回到速查卡照读，不现场估算"],
    ["演示时间被压缩", "切换 5 分钟精简版动线", "判决剧场与实时鉴听两幕保留，其余从简"],
  ],
  [18, 40, 42]
));

/* ══ 五、评委高概率问答 ══ */
bodyChildren.push(h1("五、评委高概率问答"));
bodyChildren.push(body("以下八问按出现概率排序，回答要点均以实测数字支撑。建议每人认领三问，赛前互相抽查。", { after: 120 }));

const qa = [
  ["问一：准确率多少？会不会误伤真人？",
   "基线 258 判决：校准集合成检出 92.5%（37/40），自然放行 0.80（40/50 判决）；宽带 F1 0.962 / Acc 0.938，综合 EER 0.18 / AUC 0.925。反诈场景里误报的代价是用户关掉软件，漏报的代价是继续被骗，所以阈值把放行真人的优先级排得更高。已知边界也主动披露：有声书存在误判、300–3400Hz 窄带下性能退化，补强计划在路线图里。"],
  ["问二：为什么不用深度学习模型？",
   "三个理由。可解释：十一维特征每一维都锚定人怎么发声、声码器怎么生成的物理差异，判决依据可被第三方复算，黑盒打分进不了证据链；v2.1 起还有帧级直流免疫与输入质量护栏，判决对录音链路扰动稳健。可移植：纯 TypeScript 零依赖，浏览器端实时跑，RTF 峰值 0.015、中位数 0.0069。可演进：深度引擎在路线图上，定位是补边界而不是替换底座。"],
  ["问三：客户端检测能信吗？会不会被绕过？",
   "客户端只做初判，结束后整段 PCM 上传服务端，用同一份引擎复核并固定哈希，双端一致性是取证可信度的基础。篡改客户端不影响服务端判决，服务端结论与证据哈希才是最终口径。"],
  ["问四：与谛听、白泽等同方向作品相比差异在哪？",
   "它们做事后文件检测，声盾做进行中的通话：滑窗流式、检出即告警。提前一分钟的告警可能直接拦下一笔转账，这是切入点的差异而非高下。五个维度的逐项对比在答辩 PPT 第 10 页，长处与补位都摆在明面上。"],
  ["问五：断网真的能用？",
   "全功能可用。我们把交付 zip 解压后放进 Linux 无外网命名空间（仅 lo 回环接口）实测基线八项 + v1.3.15 专项十一项全部通过，合成走本地 espeak-ng 约 0.23 秒，零联网零等待。评委可以当场要求拔网线重演。"],
  ["问六：存证包有法律效力吗？",
   "声盾定位是辅助验真工具，结论不构成执法意见，这一点页脚有明示。存证包提供 SHA-256 哈希、时间戳与完整 PCM 数据，为后续司法鉴定提供可复核的原始材料，而不是替代鉴定结论。"],
  ["问七：训练与校准数据哪来的？",
   "自然类为五种公开人声（含有声书，公有领域），TTS 类为七音色乘三文本，全部再造 300–3400Hz 窄带版本；权重由脚本拟合产出，全程可复现，校准明细写入技术报告。"],
  ["问八：便携包为什么 70MB？还能更小吗？",
   "58.1MB 里含 Node.js 运行时、Windows 版 espeak-ng、VC++ 2015-2022 运行库三个 DLL（约 695KB，Win10/11 解压即用免安装）与全部前端资源，不装任何软件。相比 v1.3.2 官方包的 285.9MB 已精简约 80%：剔除了多平台二进制与非 SQLite 的 WASM 等。再压缩需要换运行时，收益边际递减。"],
];
for (const [q, a] of qa) {
  bodyChildren.push(new Paragraph({
    keepNext: true, spacing: { before: 200, after: 60 },
    children: [new TextRun({ text: q, bold: true, size: 24, color: P.primary,
      font: { eastAsia: "SimHei", ascii: "Times New Roman" } })],
  }));
  bodyChildren.push(body(a, { after: 120 }));
}

/* ══ 六、附录 ══ */
bodyChildren.push(h1("六、附录：v1.3.8–v1.3.15 交付与验证摘要"));
bodyChildren.push(body("本节为 v1.3.8 便携包的交付与增量验证记录，可直接并入报告作为补充章节。版本链路：v1.3.4 判决剧场，v1.3.5 纯离线发行锁（云端通道整体移除、启动自检、证据完整性核验、系统自检页），v1.3.6 修复 Windows 启动失败（Turbopack 外部依赖软链丢失），v1.3.7 为 espeak-ng 随包 VC++ 运行库（必要依赖），v1.3.8 修正其真正根因——包内 DLL 文件名与 exe 导入表不匹配（导入表要求连字符 libespeak-ng.dll，包内为下划线 libespeak_ng.dll，任何 Windows 上均 0xC0000135），以双文件名随包 + 三层运行时自愈 + 打包期 PE 导入表硬闸彻底关闭该问题。v1.3.9 修正应用内合成通道（Turbopack 平台折叠）并强化并发存证；v1.3.12 为引擎 v2.0.0-calibrated 学术增强（十一维特征 + EER/AUC 学术口径，258 判决基线）；v1.3.13 引入 vitest 单元测试体系与 GitHub Actions CI；v1.3.14 为安全加固版（证据链路径遍历修复 + 全站 HTTP 安全响应头）；v1.3.15 为抗干扰鲁棒性版（引擎 v2.1.0-robust：帧级直流免疫 + 输入质量护栏四项诊断，258 判决基线逐位复验一致，单测增至 145 项）。", { after: 120 }));
bodyChildren.push(tableTitle("表 4 v1.3.8 关键修复与特性"));
bodyChildren.push(dataTable(
  ["特性", "说明"],
  [
    ["DLL 双文件名随包（v1.3.8 根因修正）", "espeak-ng.exe 导入表要求连字符 libespeak-ng.dll，包内自此双文件名并存（连字符 + 下划线互为拷贝）；VC++ 运行库三 DLL 仍随包（必要依赖，微软官方 VCLibs 提取），Win10/11 解压即用免安装"],
    ["三层自愈与如实诊断", "boot.js 启动补齐别名 / 合成探测前补齐 / windows-smoke.cmd 就地修复（随包分发，10 秒冒烟）；退出码翻译修正：0xC0000135=包内 DLL 缺失或文件名不匹配（v1.3.8 修正 v1.3.7 的 VC++ 误诊）、0xC0000139=入口点缺失、0xC0000005=访问违例"],
    ["启动韧性 + 打包硬闸", "espeak 组件缺失降级为警告继续（预置样本 Tier4 兜底）；打包流水线新增 PE 导入表硬闸：包内任何二进制引用的每个 DLL 必须按名可解析，否则拒绝打包——本类事故从构建期拦截"],
    ["判决剧场", "环形置信度仪表刻度环逐格点亮与数字滚动收敛，判决印章砸落动画（深伪检出红章 / 疑似合成橙章 / 存在可疑琥珀章 / 真人语音翠章）"],
    ["时频取证视图", "客户端 FFT（1024 点汉宁窗）生成对数频率轴瀑布热力图，可疑片段红色高亮，点击图面任意位置跳转播放"],
    ["纯离线发行锁（承 v1.3.5）", "云端合成通道从发行包整体移除：界面无开关、切换接口 403 锁死、零联网路径"],
  ],
  [24, 76]
));
bodyChildren.push(tableTitle("表 5 断网实测明细（解压交付 zip · 无外网命名空间 · 仅 lo 接口）"));
bodyChildren.push(dataTable(
  ["测试项", "结果"],
  [
    ["合成挑战（本地 espeak）", "通过 · HTTP 200 · 约 0.23 秒 · 零联网零等待"],
    ["实时鉴听（PCM 复核）", "通过 · HTTP 200 · 服务端复核并固定哈希"],
    ["文件检测", "通过 · HTTP 200 · 与鉴听管线同引擎"],
    ["案例库", "通过 · HTTP 200 · 4 条种子案例完整"],
    ["存证包下载", "通过 · HTTP 200 · WAV 格式校验正确（RIFF 头）"],
    ["云端通道锁", "通过 · 切换接口 403，发行包零联网路径"],
    ["系统自检", "通过 · 数据引擎/证据目录/引擎校准/本地合成引擎/离线声明五项全绿"],
    ["证据完整性核验", "通过 · 重算 SHA-256 与入库值逐项一致（实测篡改 1 字节立即检出）"],
  ],
  [36, 64]
));
bodyChildren.push(body("交付物：ShieldEar-v1.3.8-portable.zip，70.2MB（1921 文件），SHA-256 为 36d579020090880f245f177044b557cd6cff146e9fb8426465f6c02ab5eb71ee，与 GitHub Release v1.3.8 附件字节一致，发布时已校验。Release 页面另附完整特性说明与升级方式；v1.3.5 / v1.3.6 / v1.3.7 说明页已加修复指引横幅。", { after: 80 }));
bodyChildren.push(body("v1.3.15 交付物：ShieldEar-v1.3.15-portable.zip，58.1MB（1,361 文件），SHA-256 为 c4ce7ac35ca42f1f8235d6a690bd1734a63227bc5d25f93ab0baffbe2244e317，与 GitHub Release v1.3.15 附件字节一致（CDN 回读三方一致，发布时已校验）。断网实测：基线 8/8 + v1.3.15 专项 11/11 全绿（直流免疫 ratio 漂移 0.00001、质量护栏清洁基线四项全清、触发矩阵精确警示、安全响应头五项、并发存证 6/6）；依赖安全 bun audit 106→1（5 critical 清零）+ COOP/CORP。", { after: 80 }));
bodyChildren.push(body("彩排环境备注：本手册四张截图取自源码开发环境实测（与便携包同一份引擎与同套话术模板，espeak-ng 同为本地合成），判决剧场 56.7% 为当场实测值，与便携包交付行为一致。", { after: 80 }));

/* ───────── 页脚 ───────── */
function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: P.secondary })],
    })],
  });
}

/* ───────── 组装 ───────── */
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimSun" }, size: 24, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 32, bold: true, color: P.primary },
        paragraph: { spacing: { before: 400, after: 200 } },
      },
      heading2: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 28, bold: true, color: P.primary },
        paragraph: { spacing: { before: 280, after: 140 } },
      },
    },
  },
  numbering: {
    config: ["ops-s1", "ops-s5"].map(ref => ({
      reference: ref,
      levels: [{
        level: 0, format: LevelFormat.DECIMAL, text: "%1.",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    })),
  },
  sections: [
    { /* 封面 */
      properties: {
        page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      },
      children: buildCoverR1({
        title: "声盾答辩演示手册",
        subtitle: "v1.3.15 纯离线发行版 · 演示剧本 / 关键数字 / 应急预案 / 评委问答",
        englishLabel: "SHIELDEAR DEFENSE HANDBOOK",
        metaLines: [
          "版本：v1.3.15（对应 GitHub Release tag v1.3.15 · 引擎 v2.1.0-robust）",
          "队伍：你们说的对 · 大连理工大学",
          "日期：2026 年 11 月",
          "用途：队内彩排资料",
        ],
        footerLeft: "SHIELDEAR v1.3.15", footerRight: "FOR TEAM REHEARSAL",
        palette: COVER,
      }),
    },
    { /* 目录（罗马页码） */
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
          pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN },
        },
      },
      footers: { default: pageFooter() },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "目  录", bold: true, size: 32,
            font: { eastAsia: "SimHei", ascii: "Times New Roman" } })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "注：本目录由域代码生成。如编辑后页码变动，请在目录上点击右键并选择「更新域」以刷新页码。",
            italics: true, size: 18, color: "888888",
            font: { eastAsia: "SimSun", ascii: "Times New Roman" } })],
        }),
      ],
    },
    { /* 正文（阿拉伯页码从 1 起） */
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      footers: { default: pageFooter() },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log("OK " + OUT + " (" + buf.length + " bytes)");
});
