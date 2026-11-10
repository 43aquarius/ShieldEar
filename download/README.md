# 声盾 ShieldEar 交付物清单

## 最新发行版（GitHub Releases）

- **v1.3.15（引擎 v2.1.0-robust 抗干扰鲁棒性版，2026-11-10）**：https://github.com/43aquarius/ShieldEar/releases/tag/v1.3.15
  - 引擎直流免疫（+0.05 直流判决不变，ratio 漂移 0.00001）+ 输入质量护栏四项诊断（削波/直流/底噪/电平）+ 依赖安全清零（next 16.4.6 等，bun audit 106→1）+ COOP/CORP
  - 便携包 `ShieldEar-v1.3.15-portable.zip`（58.1MB，1,361 文件）· SHA-256 `c4ce7ac35ca42f1f8235d6a690bd1734a63227bc5d25f93ab0baffbe2244e317`
  - 断网实测：基线 8/8 + v1.3.15 专项 11/11 全绿（直流免疫/质量护栏/触发矩阵对交付包实测）；CDN 回读三方一致
- **v1.3.14（安全加固版，2026-11-09）**：https://github.com/43aquarius/ShieldEar/releases/tag/v1.3.14
  - 证据链路径遍历修复（格式闸 + 容器闸双防线）+ 全站 HTTP 安全响应头（CSP connect-src 'self' = 零外连声明的传输层强制）
  - 便携包 `ShieldEar-v1.3.14-portable.zip`（57.9MB，1,459 文件）· SHA-256 `ed9a6d71189e9f44a78be352e6849782444e1ff9660bf6589f8b8d3f91cb8333`
  - 断网实测：基线 8/8 + v1.3.14 专项 9/9 全绿（安全头/格式闸对交付包实测）
- 历史版本：v1.3.12（引擎 v2.0 学术增强）等见 Releases 页

## 参赛文档（docs/ 同步推送至 GitHub · v1.3.15 口径）

| 文件 | 说明 |
|------|------|
| `声盾-参赛技术报告.docx` | 系统设计方案（32页）：功能、指标、实现原理、总体架构图、软件流程图、九章正文 + 国内外研究现状（三线文献综述）+ 学术对比表 + 参考文献（GB/T 7714，15篇） |
| `声盾-系统测试报告.docx` | 测试报告（24页）：测试设备、测试数据、结果分析、实现功能、特色（258条判决全量评测 + EER/AUC 学术口径） |
| `声盾-作品简介.docx` | 作品简介（2页）：定位、功能、指标（含EER/AUC）、创新点、应用前景 |
| `声盾-参赛作品声明.docx` | 版权、原创性、开源组件、技术公开与数据合规声明（含签署栏） |
| `声盾-答辩演示.pptx` | 13页答辩演示（含逐字稿讲者备注，v1.3.15 口径：引擎 v2.1.0-robust 十一维特征/直流免疫/质量护栏、258 判决基线、EER 0.18/AUC 0.925、145 项单测）；重建为 2x 高清满幅图 + 备注（原文本层生成管线遗失，见 worklog） |
| `声盾-答辩演示-预览版.pdf` | PPT 预览版（与 pptx 同源渲染） |
| `声盾-答辩演示手册.docx` | 队内彩排资料（13页）：检查清单、五幕演示剧本、关键数字速查卡（258 基线/EER 0.18/AUC 0.925/v2.1.0-robust/58.1MB）、应急预案、评委八问；附录 v1.3.8 历史实录保留 + 续写 v1.3.15 |

## 图表原图（assets/）

- `fig_architecture.png` / `fig_pipeline.png` — 系统总体架构图、软件流程图
- `test_confusion.png` / `test_groups.png` / `test_scores.png` / `test_latency.png` / `test_t3voice.png` — 测试报告全部图表（v2.0 引擎数据重制）
- `chart_feature_sep.png` / `chart_file_scores.png` — 技术报告图表（十一维特征分离度、逐文件判决，v2.0 数据）
- `shield_*.png` — 平台截图

## 代码仓库

- GitHub：https://github.com/43aquarius/ShieldEar（public，main 分支）
- 含全部源码、测试套件、校准数据（16k自然源 + z-ai TTS样本 + Edge 跨引擎独立集）、逐条判决记录（testsuite_results.json）、候选特征探针（probe-v2-features.ts，负结果留档）

## 测试数据（calibration/）

- `testsuite_results.json` — 258条判决全量记录（v2.0.0-calibrated，含EER/AUC）
- `features.json` — 50条特征记录（十一维）
- `audio/` — 129个音频文件（仓库含可再生源与Edge独立集，变体由 gen-*-variants.ts 确定性再生）

## 一键复现

```bash
bun scripts/gen-natural-variants.ts && bun scripts/gen-tts-variants.ts && bun scripts/run-testsuite.ts
python3 scripts/gen-test-figures.py && bun scripts/probe-v2-features.ts   # 图表 + 候选特征负结果复现
```
