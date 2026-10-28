"use client";

/**
 * 声盾 — 检测结果面板
 * 判决卡 → 逐窗置信度曲线 → 可疑片段时间轴 → 可解释特征剖面 → 逐窗明细 → 证据链
 */

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfidenceCurve } from "./confidence-curve";
import { FeatureProfile } from "./feature-profile";
import { HashText } from "./hash-text";
import { LabelBadge, RISK_META, RiskBadge, scoreColor } from "./risk-ui";
import { useShield } from "@/lib/store";
import { formatDuration, formatTime } from "@/lib/client/audio-client";
import type { AnalysisResult, Segment } from "@/lib/engine/types";
import {
  FileCheck2,
  Printer,
  Download,
  ShieldAlert,
  Fingerprint,
  Activity,
  Server,
  Gauge,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useReport } from "./report-print";

function TimelineBar({ segments, duration }: { segments: Segment[]; duration: number }) {
  return (
    <div className="space-y-1.5">
      <div className="relative h-7 overflow-hidden rounded-md border bg-black/30">
        {/* 秒刻度 */}
        {Array.from({ length: Math.min(12, Math.ceil(duration)) + 1 }).map((_, i) => {
          const t = (i / Math.min(12, Math.ceil(duration))) * duration;
          return (
            <div
              key={i}
              className="absolute top-0 h-full w-px bg-white/5"
              style={{ left: `${(t / duration) * 100}%` }}
            />
          );
        })}
        {segments.map((s, i) => (
          <div
            key={i}
            className="absolute top-1 h-5 rounded-sm border"
            style={{
              left: `${(s.startSec / duration) * 100}%`,
              width: `${Math.max(1.2, ((s.endSec - s.startSec) / duration) * 100)}%`,
              background: "rgba(248,113,113,0.55)",
              borderColor: "rgba(248,113,113,0.8)",
            }}
            title={`${s.startSec.toFixed(1)}s–${s.endSec.toFixed(1)}s · 均值 ${(s.meanScore * 100).toFixed(0)}% · 峰值 ${(s.peakScore * 100).toFixed(0)}%`}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono-data text-[10px] text-muted-foreground">
        <span>0:00</span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  );
}

export function ResultPanel() {
  const { result, meta, audioUrl } = useShield();
  const { print } = useReport();
  const { toast } = useToast();

  if (!result) return null;
  const { overall, audio, windows, segments, featureProfile, stats, channel } = result;
  const risk = RISK_META[overall.risk];
  const voiced = windows.filter((w) => w.voiced);

  return (
    <div className="space-y-4 print:hidden" id="result-root">
      {/* 判决卡 */}
      <Card className={cnRisk(overall.risk)}>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid-bg flex h-12 w-12 items-center justify-center rounded-lg border bg-black/40">
                {overall.risk === "LOW" ? (
                  <FileCheck2 className="h-6 w-6 text-emerald-400" aria-hidden />
                ) : (
                  <ShieldAlert className={cnRiskIcon(overall.risk)} aria-hidden />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className={`text-xl font-bold ${risk.color}`}>{overall.verdict}</h2>
                  <RiskBadge risk={overall.risk} />
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{risk.desc}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-right sm:grid-cols-4">
              <Stat label="合成置信度" value={`${(overall.syntheticRatio * 100).toFixed(1)}%`} />
              <Stat label="峰值置信度" value={`${(overall.maxScore * 100).toFixed(1)}%`} />
              <Stat label="有效语音窗" value={`${audio.voicedWindows}/${audio.totalWindows}`} />
              <Stat label="分析耗时" value={`${stats.analyzeMs.toFixed(0)}ms · RTF ${stats.rtf.toFixed(3)}`} />
            </div>
          </div>
          <div className="rounded-lg border border-dashed p-3 text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">处置建议：</span>
            {overall.advice}
          </div>
          {meta && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="gap-1 font-mono-data">
                <Fingerprint className="h-3 w-3" aria-hidden /> {meta.caseNo}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Server className="h-3 w-3" aria-hidden /> 服务端复核存证
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Gauge className="h-3 w-3" aria-hidden />
                {channel === "narrowband" ? "窄带（电话）信道模式" : "宽带信道模式"}
              </Badge>
              <span className="text-muted-foreground">
                {meta.sourceType === "LIVE" ? "实时鉴听" : meta.sourceType === "TTS" ? "现场合成挑战" : "文件检测"} ·{" "}
                {formatTime(meta.createdAt)}
              </span>
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    toast({
                      title: "正在生成打印视图",
                      description: "在打印对话框中选择「另存为 PDF」即可导出核验报告",
                    });
                    setTimeout(() => print(), 150);
                  }}
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden /> 导出核验报告
                </Button>
                {meta.caseNo && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() =>
                      window.open(`/api/evidence/${meta.caseNo}?kind=evidence`, "_blank")
                    }
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden /> 证据音频
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 音频回放 */}
      {audioUrl && (
        <audio controls src={audioUrl} className="w-full" preload="metadata">
          <track kind="captions" />
        </audio>
      )}

      {/* 置信度曲线 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-emerald-400" aria-hidden /> 逐窗置信度曲线
          </CardTitle>
          <CardDescription>
            滑动窗口 2s / 步进 1s（50% 重叠）· 中值 + 指数平滑 · 逐窗判决可追溯
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConfidenceCurve windows={windows} />
        </CardContent>
      </Card>

      {/* 可疑片段时间轴 */}
      {segments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">可疑片段时间轴</CardTitle>
            <CardDescription>
              共 {segments.length} 段 · 点击片段查看明细（红色区段 = 可疑/合成窗口）
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <TimelineBar segments={segments} duration={audio.durationSec} />
            <div className="slim-scroll max-h-36 overflow-y-auto rounded border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium">#</th>
                    <th className="px-3 py-1.5 font-medium">起止（秒）</th>
                    <th className="px-3 py-1.5 font-medium">时长</th>
                    <th className="px-3 py-1.5 font-medium">均值置信度</th>
                    <th className="px-3 py-1.5 font-medium">峰值</th>
                    <th className="px-3 py-1.5 font-medium">窗口数</th>
                  </tr>
                </thead>
                <tbody className="font-mono-data">
                  {segments.map((s, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5">{i + 1}</td>
                      <td className="px-3 py-1.5">
                        {s.startSec.toFixed(1)} – {s.endSec.toFixed(1)}
                      </td>
                      <td className="px-3 py-1.5">{(s.endSec - s.startSec).toFixed(1)}s</td>
                      <td className="px-3 py-1.5" style={{ color: scoreColor(s.meanScore) }}>
                        {(s.meanScore * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-1.5" style={{ color: scoreColor(s.peakScore) }}>
                        {(s.peakScore * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-1.5">{s.windows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 可解释特征剖面 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">可解释特征剖面</CardTitle>
          <CardDescription>判决依据逐特征展开（可审计、可复核）</CardDescription>
        </CardHeader>
        <CardContent>
          <FeatureProfile items={featureProfile} />
        </CardContent>
      </Card>

      {/* 逐窗明细 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">逐窗判决明细</CardTitle>
          <CardDescription>完整检测过程留痕（{windows.length} 窗）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="slim-scroll max-h-72 overflow-y-auto rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">窗口</th>
                  <th className="px-3 py-1.5 font-medium">起止（秒）</th>
                  <th className="px-3 py-1.5 font-medium">平滑置信度</th>
                  <th className="px-3 py-1.5 font-medium">原始置信度</th>
                  <th className="px-3 py-1.5 font-medium">判决</th>
                  <th className="px-3 py-1.5 font-medium">电平</th>
                  <th className="px-3 py-1.5 font-medium">信道</th>
                </tr>
              </thead>
              <tbody className="font-mono-data">
                {windows.map((w) => (
                  <tr key={w.index} className="border-t">
                    <td className="px-3 py-1.5">#{w.index + 1}</td>
                    <td className="px-3 py-1.5">
                      {w.startSec.toFixed(1)} – {w.endSec.toFixed(1)}
                    </td>
                    <td className="px-3 py-1.5" style={{ color: scoreColor(w.score) }}>
                      {w.voiced ? (w.score * 100).toFixed(1) + "%" : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {w.voiced ? (w.rawScore * 100).toFixed(1) + "%" : "—"}
                    </td>
                    <td className="px-3 py-1.5">{w.voiced ? <LabelBadge label={w.label} /> : "静音"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{w.rmsDb.toFixed(0)}dB</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {w.channel === "narrowband" ? "窄带" : "宽带"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 证据链 */}
      {meta && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Fingerprint className="h-4 w-4 text-emerald-400" aria-hidden /> 证据固定（哈希存证链）
            </CardTitle>
            <CardDescription>证据材料以 SHA-256 固定，任何篡改都会导致哈希失配</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <HashRow
              label="案件编号"
              value={
                <span className="font-mono-data text-sm text-foreground">{meta.caseNo}</span>
              }
            />
            <HashRow label="存证时间" value={<span className="font-mono-data text-sm">{formatTime(meta.createdAt)}</span>} />
            <HashRow
              label="证据音频 SHA-256"
              value={<HashText hash={meta.audioHash} />}
            />
            {meta.sourceHash && (
              <HashRow
                label={meta.sourceType === "TTS" ? "原始合成音频 SHA-256" : "原始上传文件 SHA-256"}
                value={<HashText hash={meta.sourceHash} />}
              />
            )}
            <HashRow
              label="检测引擎"
              value={
                <span className="font-mono-data text-sm">
                  ShieldEar {meta.engineVersion}（客户端初判 + 服务端复核，同构引擎保证一致判决）
                </span>
              }
            />
            {meta.rtf !== undefined && (
              <HashRow
                label="实时因子 RTF"
                value={<span className="font-mono-data text-sm">{meta.rtf.toFixed(3)}（&lt; 1 即满足实时）</span>}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* 演示提示 */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        合规声明：声盾为辅助验真工具，判决结论附带置信度与不确定性说明，不构成执法结论；
        演示音频均为平台合成或公有领域样本，未使用任何他人真实通话。
        {voiced.length === 0 && " 本段音频未检出有效语音，结论不具参考性。"}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono-data text-base font-semibold text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function HashRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {value}
    </div>
  );
}

function cnRisk(risk: string): string {
  switch (risk) {
    case "CRITICAL":
      return "border-red-800/70 bg-red-950/20";
    case "HIGH":
      return "border-orange-800/70 bg-orange-950/20";
    case "MEDIUM":
      return "border-amber-800/70 bg-amber-950/20";
    default:
      return "border-emerald-800/70 bg-emerald-950/20";
  }
}

function cnRiskIcon(risk: string): string {
  switch (risk) {
    case "CRITICAL":
      return "h-6 w-6 text-red-400";
    case "HIGH":
      return "h-6 w-6 text-orange-400";
    case "MEDIUM":
      return "h-6 w-6 text-amber-400";
    default:
      return "h-6 w-6 text-emerald-400";
  }
}
