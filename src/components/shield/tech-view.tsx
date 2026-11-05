"use client";

/**
 * 声盾 — 技术方案视图（应用内技术白皮书）
 * 面向评委与复核者：架构、算法、校准方法、指标体系、诚实边界与升级路线
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Layers,
  AudioWaveform,
  Cpu,
  FileBadge,
  ShieldCheck,
  Gauge,
  FlaskConical,
  GitBranch,
  Scale,
  ArrowUpCircle,
} from "lucide-react";

const ARCH_ROWS = [
  {
    layer: "采集层",
    icon: AudioWaveform,
    modules: "麦克风实时流（AudioWorklet 16kHz）· 文件导入（浏览器解码重采样）· TTS 现场合成（24kHz→16kHz）",
    points: "统一至 16kHz 单声道分析标准；AudioWorklet 采集零回退丢失，兼容 ScriptProcessor 降级",
  },
  {
    layer: "检测引擎层",
    icon: Cpu,
    modules: "ShieldEar 轻量可解释引擎（8 维声学特征 + 数据驱动校准评分）",
    points: "2s 滑窗 / 1s 步进 / 50% 重叠；帧级 25ms 分析；同构 TS 实现，浏览器与服务端运行同一份代码",
  },
  {
    layer: "判决融合层",
    icon: Layers,
    modules: "逐窗逻辑回归评分 → 中值滤波 + 指数平滑 → 能量加权整段判决",
    points: "静音窗显式排除；不确定样本标注「可疑」而非硬判；窄带信道自动切换时域特征子集",
  },
  {
    layer: "业务层",
    icon: FileBadge,
    modules: "风险分级提示 · SHA-256 哈希固定 · 案例入库 · 核验报告生成",
    points: "证据 WAV 落盘 + 哈希锚定；客户端初判 + 服务端复核双端一致；报告可导出 PDF",
  },
  {
    layer: "展示层",
    icon: Gauge,
    modules: "实时波形 / 逐窗置信度曲线 / 时间轴标注 / 特征剖面 / 案例库",
    points: "单页应用零跳转完成全部演示动线；全流程留痕可回放",
  },
];

const FEATURE_TABLE = [
  { name: "高频谱平坦度", key: "hfFlatness", band: "4–8kHz", what: "频谱几何/算术均值比", why: "声码器高频噪声填充 vs 自然谐波-气流混合形态" },
  { name: "高频能量占比", key: "hfEnergyRatio", band: ">3.25kHz", what: "高频能量/总能量", why: "梅尔谱合成器高频能量分布系统性偏移" },
  { name: "谐波规整度", key: "hnr", band: "全带", what: "归一化自相关峰值（HNR 代理）", why: "自然嗓音谐波纯度随生理动态起伏，合成语音异常规整" },
  { name: "嗓音动力波动", key: "hnrCV", band: "全带", what: "HNR 的帧间变异系数", why: "自然重音/气息带来的动力变化 vs 合成的均匀性" },
  { name: "谱通量波动度", key: "fluxCV", band: "全带", what: "帧间谱变化 CV", why: "神经声码器帧边界微观不连续指纹" },
  { name: "基音微扰", key: "jitter", band: "基音", what: "相邻浊音帧周期相对扰动", why: "自然声带生理性抖动区间 vs 声码器周期稳定度" },
  { name: "过零率波动度", key: "zcrCV", band: "全带", what: "ZCR 变异系数", why: "辅音元音交替的自然波动 vs 合成的稳定性" },
  { name: "高频周期性", key: "hfPeriodicity", band: "4–8kHz", what: "高频段在基音周期处的自相关", why: "声码器把谐波延展到高频，自然语音高频以气息噪声为主" },
];

const CALIB_STEPS = [
  { step: "1. 样本构造", desc: "自然类：MDN / wavesurfer.js 公开人声录音 5 种（含有声书）；合成类：平台 TTS 7 音色 × 3 文本 = 20 段；另对两类均构造 300–3400Hz 电话窄带退化版本（50 条特征记录）。" },
  { step: "2. 先验拟合", desc: "按信道分别取自然类各特征 μ/σ 作为「自然人声统计先验」— z 分数即偏离同信道自然语音的程度。" },
  { step: "3. 权重拟合", desc: "类加权（natural×4）L2 正则逻辑回归，梯度下降 4000 轮；宽带用全部 8 特征，窄带仅用时域 5 特征（高频特征失效清零）。" },
  { step: "4. 验证", desc: "样本内：宽带 TTS 判合成 20/20、自然判正常 4/5；窄带 TTS 16/20、自然 4/5；自然类留一（LOO）稳定性检验。脚本 scripts/fit-weights.ts 全程可复现。" },
];

const METRICS = [
  { name: "EER（等错误率）", def: "误报率 = 漏报率时的错误率", status: "深度引擎接入后于 ASVspoof 2019/2021 LA 基准复现（目标百分之一量级）" },
  { name: "RTF（实时因子）", def: "分析耗时 / 音频时长", status: "轻量引擎实测 0.003–0.008（2s 窗约 7–25ms），CPU 即满足实时" },
  { name: "判决时延", def: "窗口完成到判决输出", status: "≤ 1s（窗口步进）+ 引擎毫秒级，满足「边通话边检测」" },
  { name: "跨信道鲁棒性", def: "窄带退化下的检出率", status: "窄带 TTS 检出 16/20（诚实呈现信道退化影响，作为评测贡献点）" },
];

const ROADMAP = [
  {
    title: "阶段二：AASIST / RawGAT-ST 双网络集成",
    desc: "按官方流程在 ASVspoof 2019 LA 复现两基线（谱-时域图注意力 + 原始波形图注意力，输入模态互补），软投票融合优于单模型；评测含 t-DCF 与 EER，以 2019 LA 复现结果作为工程正确性锚点。",
  },
  {
    title: "阶段三：ONNX 轻量化与 CPU 实时",
    desc: "PyTorch → ONNX 动态量化，目标普通笔记本 CPU 双网络并发 RTF < 1；不达标则知识蒸馏至单一轻量学生网络兜底；量化前后速度/精度消融表入报告。",
  },
  {
    title: "阶段四：跨信道评测贡献",
    desc: "ASVspoof 2021 LA（含信道退化）+ 自建 8kHz 窄带子集，Rawboost 信道增强调参，把「跨信道鲁棒性评测」本身做成作品的评测贡献点（对应本平台窄带模式）。",
  },
];

export function TechView() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden /> 技术方案总览
          </CardTitle>
          <CardDescription>
            声盾 = 单点深挖的实时鉴伪引擎 + 反诈业务闭环。算法为核心、公开基准给硬指标、轻量平台承载演示、双端一致引擎保障取证可信度。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <HighlightChip title="竞赛类别" text="应用安全（内容安全）· AI 语音鉴伪" />
            <HighlightChip title="政策支点" text="《反电信网络诈骗法》《深度合成管理规定》" />
            <HighlightChip title="差异化三件套" text="实时流式 · 轻量可解释 · 反诈存证闭环" />
          </div>
        </CardContent>
      </Card>

      {/* 分层架构 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">五层架构</CardTitle>
          <CardDescription>采集 → 引擎 → 融合 → 业务 → 展示，全链路留痕</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {ARCH_ROWS.map((r) => (
              <div key={r.layer} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[128px_1fr]">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <r.icon className="h-4 w-4 text-emerald-400" aria-hidden />
                  {r.layer}
                </div>
                <div className="space-y-1">
                  <p className="text-xs leading-5">{r.modules}</p>
                  <p className="text-[11px] leading-4 text-muted-foreground">{r.points}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 特征集 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AudioWaveform className="h-4 w-4 text-emerald-400" aria-hidden /> 8 维声学特征（判决完全可解释）
          </CardTitle>
          <CardDescription>每一维都对应一类声码器/自然人声的物理差异，判决可逐特征审计</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="slim-scroll overflow-x-auto rounded border">
            <table className="w-full text-xs">
              <thead className="bg-muted/60">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">特征</th>
                  <th className="px-3 py-2 font-medium">频段</th>
                  <th className="px-3 py-2 font-medium">计算</th>
                  <th className="px-3 py-2 font-medium">物理依据</th>
                </tr>
              </thead>
              <tbody>
                {FEATURE_TABLE.map((f) => (
                  <tr key={f.key} className="border-t">
                    <td className="px-3 py-2 font-medium">{f.name}</td>
                    <td className="px-3 py-2 font-mono-data text-muted-foreground">{f.band}</td>
                    <td className="px-3 py-2">{f.what}</td>
                    <td className="px-3 py-2 text-muted-foreground">{f.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 校准方法论 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4 text-emerald-400" aria-hidden /> 数据驱动校准（可复现）
          </CardTitle>
          <CardDescription>先验与权重不靠拍脑袋：真实样本 + 逻辑回归 + 留一验证</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {CALIB_STEPS.map((s) => (
            <div key={s.step} className="rounded-lg border p-3">
              <div className="text-xs font-semibold">{s.step}</div>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 指标体系 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4 text-emerald-400" aria-hidden /> 指标体系（含实测）
          </CardTitle>
          <CardDescription>有数据集、有基线、有对比，指标可复现才是可信作品</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {METRICS.map((m) => (
              <div key={m.name} className="grid gap-1 rounded-lg border p-3 sm:grid-cols-[180px_1fr]">
                <div>
                  <div className="text-xs font-semibold">{m.name}</div>
                  <div className="text-[11px] text-muted-foreground">{m.def}</div>
                </div>
                <p className="text-[11px] leading-5">{m.status}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 诚实边界 */}
      <Card className="border-amber-800/50 bg-amber-950/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-amber-300">
            <Scale className="h-4 w-4" aria-hidden /> 已知边界（诚实呈现）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-xs leading-5 text-muted-foreground">
            <li>· 轻量引擎的先验来自有限自然样本（5 种录音/含有声书）：录音棚级干净自然人声（专业有声书）存在误判可能，该场景需深度模型；</li>
            <li>· 窄带（电话）信道损失高频信息，时域特征区分度下降（检出 16/20）：信道鲁棒性是深度引擎阶段的核心评测点；</li>
            <li>· 检测结论附带置信度与不确定性说明，定位为反诈辅助验真工具，不构成执法结论；</li>
            <li>· 权威基准 EER 指标将在 AASIST / RawGAT-ST 复现阶段于 ASVspoof 2019/2021 LA 上给出。</li>
          </ul>
        </CardContent>
      </Card>

      {/* 升级路线 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 text-emerald-400" aria-hidden /> 引擎升级路线（架构已预留接口）
          </CardTitle>
          <CardDescription>轻量可解释引擎是第一阶段；深度集成是第二到四阶段</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {ROADMAP.map((r, i) => (
            <div key={r.title} className="flex gap-3 rounded-lg border p-3">
              <Badge variant="outline" className="h-fit shrink-0 font-mono-data">
                <ArrowUpCircle className="mr-1 h-3 w-3" aria-hidden />
                {i + 2}
              </Badge>
              <div>
                <div className="text-xs font-semibold">{r.title}</div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{r.desc}</p>
              </div>
            </div>
          ))}
          <p className="pt-1 text-[11px] leading-5 text-muted-foreground">
            开源底座映射：clovaai/aasist（AASIST 官方实现）· asvspoof-challenge（RawGAT-ST 训练代码）·
            Rawboost（信道增强）· torchaudio / librosa / FFmpeg（特征与流处理）· ONNX Runtime（量化部署）。
            本平台检测引擎层为同构 TS 实现，ONNX 集成仅替换推理后端，业务层零改动。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function HighlightChip({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border p-2.5">
      <div className="text-[11px] text-muted-foreground">{title}</div>
      <div className="mt-0.5 text-xs font-medium leading-4">{text}</div>
    </div>
  );
}
