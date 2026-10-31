# 声盾 ShieldEar 交付物清单

## 参赛文档（docs/ 同步推送至 GitHub）

| 文件 | 说明 |
|------|------|
| `声盾-参赛技术报告.docx` | 系统设计方案（24页）：功能、指标、实现原理、总体架构图、软件流程图、九章节 |
| `声盾-系统测试报告.docx` | 测试报告（21页）：测试设备、测试数据、结果分析、实现功能、特色（210条真实判决） |
| `声盾-作品简介.docx` | 作品简介（2页）：定位、功能、指标、创新点、应用前景 |
| `声盾-参赛作品声明.docx` | 版权、原创性、开源组件、技术公开与数据合规声明（含签署栏） |
| `声盾-答辩演示.pptx` | 13页答辩演示（含讲者备注） |
| `声盾-答辩演示-预览版.pdf` | PPT 预览版 |

## 图表原图（assets/）

- `fig_architecture.png` / `fig_pipeline.png` — 系统总体架构图、软件流程图（新增）
- `test_confusion.png` / `test_groups.png` / `test_scores.png` / `test_latency.png` / `test_t3voice.png` — 测试报告全部图表（新增）
- `chart_feature_sep.png` / `chart_file_scores.png` / `shield_*.png` — 技术报告图表与平台截图

## 代码仓库

- GitHub：https://github.com/43aquarius/ShieldEar（public，main 分支，2 commits）
- 含全部源码、测试套件、校准数据（16k自然源+TTS样本）、逐条判决记录（testsuite_results.json）

## 测试数据（calibration/）

- `testsuite_results.json` — 210条判决全量记录（本次新增）
- `audio/` — 110个音频文件（含 nvar/tvar 变体，本地保留全量，仓库仅含可再生源）

## 一键复现

```bash
bun scripts/gen-natural-variants.ts && bun scripts/gen-tts-variants.ts && bun scripts/run-testsuite.ts
```
