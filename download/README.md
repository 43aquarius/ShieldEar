# 声盾 ShieldEar 交付物清单

## 参赛文档（docs/ 同步推送至 GitHub · v1.3.12 口径）

| 文件 | 说明 |
|------|------|
| `声盾-参赛技术报告.docx` | 系统设计方案（32页）：功能、指标、实现原理、总体架构图、软件流程图、九章正文 + 国内外研究现状（三线文献综述）+ 学术对比表 + 参考文献（GB/T 7714，15篇） |
| `声盾-系统测试报告.docx` | 测试报告（24页）：测试设备、测试数据、结果分析、实现功能、特色（258条判决全量评测 + EER/AUC 学术口径） |
| `声盾-作品简介.docx` | 作品简介（2页）：定位、功能、指标（含EER/AUC）、创新点、应用前景 |
| `声盾-参赛作品声明.docx` | 版权、原创性、开源组件、技术公开与数据合规声明（含签署栏） |
| `声盾-答辩演示.pptx` | 13页答辩演示（含讲者备注）**（⚠ 仍为 v1.3.0 口径，待随 v1.3.12 重制）** |
| `声盾-答辩演示-预览版.pdf` | PPT 预览版 **（⚠ 同上）** |
| `声盾-答辩演示手册.docx` | 队内彩排资料（12页）：检查清单、五幕演示剧本、关键数字速查卡、应急预案、评委八问 **（⚠ 仍为 v1.3.8 口径，待随 v1.3.12 重制）** |

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
