"use client";

/**
 * 声盾 — 案例库
 * 所有检测案例（实时/文件/合成挑战）统一入库，可回看、导出报告、下载证据
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { RiskBadge } from "./risk-ui";
import { HashText } from "./hash-text";
import { ConfidenceCurve } from "./confidence-curve";
import { FeatureProfile } from "./feature-profile";
import { useShield } from "@/lib/store";
import { formatDuration, formatTime } from "@/lib/client/audio-client";
import type { AnalysisResult } from "@/lib/engine/types";
import { RefreshCw, Trash2, Eye, Printer, Download, Inbox } from "lucide-react";

interface CaseRow {
  caseNo: string;
  sourceType: string;
  sourceLabel: string;
  fileName: string | null;
  durationSec: number;
  overallRisk: string;
  syntheticRatio: number;
  createdAt: string;
  channel: string;
  rtf: number;
  totalWindows: number;
  voicedWindowCount: number;
  audioHash: string;
  engineVersion: string;
}

const SOURCE_TEXT: Record<string, string> = {
  LIVE: "实时鉴听",
  UPLOAD: "文件检测",
  TTS: "合成挑战",
};

export function CasesView() {
  const { toast } = useToast();
  const setView = useShield((s) => s.setView);
  const setResult = useShield((s) => s.setResult);
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [detail, setDetail] = useState<{ row: CaseRow; analysis: AnalysisResult } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/cases?limit=100");
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setCases(data.cases);
    } catch {
      toast({ title: "案例库加载失败", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (row: CaseRow) => {
    try {
      const resp = await fetch(`/api/cases/${row.caseNo}?full=1`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      const c = data.case;
      const analysis: AnalysisResult = {
        engine: { name: "ShieldEar", version: c.engineVersion, windowSec: 2, hopSec: 1 },
        audio: {
          durationSec: c.durationSec,
          sampleRate: 16000,
          totalWindows: c.totalWindows,
          voicedWindows: c.voicedWindowCount,
          silentWindows: c.totalWindows - c.voicedWindowCount,
        },
        overall: {
          risk: c.overallRisk,
          syntheticRatio: c.syntheticRatio,
          meanScore: c.meanScore,
          maxScore: c.maxScore,
          suspectSegmentCount: Array.isArray(c.segments) ? c.segments.length : 0,
          verdict: "",
          advice: "",
        },
        windows: c.windows as AnalysisResult["windows"],
        segments: c.segments as AnalysisResult["segments"],
        featureProfile: c.featureProfile as AnalysisResult["featureProfile"],
        channel: c.channel,
        stats: { rtf: c.rtf, analyzeMs: 0 },
      };
      setDetail({ row, analysis });
    } catch {
      toast({ title: "读取案例详情失败", variant: "destructive" });
    }
  };

  const remove = async (caseNo: string) => {
    try {
      const resp = await fetch(`/api/cases/${caseNo}`, { method: "DELETE" });
      if (!resp.ok) throw new Error();
      setCases((cs) => cs?.filter((c) => c.caseNo !== caseNo) ?? null);
      if (detail?.row.caseNo === caseNo) setDetail(null);
      toast({ title: "案例已删除", description: `证据文件同步清理：${caseNo}` });
    } catch {
      toast({ title: "删除失败", variant: "destructive" });
    }
  };

  /** 在工作台打开完整报告（含核验报告导出） */
  const openInWorkbench = () => {
    if (!detail) return;
    setResult(
      detail.analysis,
      {
        caseNo: detail.row.caseNo,
        createdAt: detail.row.createdAt,
        audioHash: detail.row.audioHash,
        sourceHash: null,
        sourceType: detail.row.sourceType as "LIVE" | "UPLOAD" | "TTS",
        sourceLabel: detail.row.sourceLabel,
        fileName: detail.row.fileName,
        durationSec: detail.row.durationSec,
        engineVersion: detail.row.engineVersion,
        rtf: detail.row.rtf,
      },
      null
    );
    setDetail(null);
    setView("workbench");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">案例库（存证记录）</CardTitle>
              <CardDescription>
                每条案例含完整逐窗判决、特征剖面与哈希证据链，支持回看与报告导出
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden /> 刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {cases === null ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : cases.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <Inbox className="h-8 w-8" aria-hidden />
              <p className="text-sm">暂无案例 — 去工作台完成一次检测即会自动存证入库</p>
            </div>
          ) : (
            <div className="slim-scroll max-h-[560px] overflow-y-auto rounded border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">案件编号</th>
                    <th className="px-3 py-2 font-medium">来源</th>
                    <th className="px-3 py-2 font-medium">对象</th>
                    <th className="px-3 py-2 font-medium">时长</th>
                    <th className="px-3 py-2 font-medium">判决</th>
                    <th className="px-3 py-2 font-medium">置信度</th>
                    <th className="px-3 py-2 font-medium">时间</th>
                    <th className="px-3 py-2 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.caseNo} className="border-t hover:bg-muted/40">
                      <td className="px-3 py-2 font-mono-data font-medium">{c.caseNo}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{SOURCE_TEXT[c.sourceType] ?? c.sourceType}</Badge>
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-muted-foreground" title={c.sourceLabel}>
                        {c.sourceLabel}
                      </td>
                      <td className="px-3 py-2 font-mono-data">{formatDuration(c.durationSec)}</td>
                      <td className="px-3 py-2">
                        <RiskBadge risk={c.overallRisk} />
                      </td>
                      <td className="px-3 py-2 font-mono-data">{(c.syntheticRatio * 100).toFixed(1)}%</td>
                      <td className="px-3 py-2 font-mono-data text-muted-foreground">{formatTime(c.createdAt)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="查看详情" onClick={() => void openDetail(c)}>
                            <Eye className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="下载证据音频"
                            onClick={() => window.open(`/api/evidence/${c.caseNo}?kind=evidence`, "_blank")}
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400" title="删除" onClick={() => void remove(c.caseNo)}>
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 详情弹窗 */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl overflow-y-auto max-h-[85vh]">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono-data">{detail.row.caseNo}</span>
                  <RiskBadge risk={detail.row.overallRisk} />
                </DialogTitle>
                <DialogDescription>
                  {SOURCE_TEXT[detail.row.sourceType]} · {detail.row.sourceLabel} ·{" "}
                  {formatDuration(detail.row.durationSec)} · {formatTime(detail.row.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <MiniStat label="合成置信度" value={`${(detail.analysis.overall.syntheticRatio * 100).toFixed(1)}%`} />
                  <MiniStat label="峰值" value={`${(detail.analysis.overall.maxScore * 100).toFixed(1)}%`} />
                  <MiniStat label="有效窗" value={`${detail.row.voicedWindowCount}/${detail.row.totalWindows}`} />
                  <MiniStat label="RTF" value={detail.row.rtf.toFixed(3)} />
                </div>
                <ConfidenceCurve windows={detail.analysis.windows} height={180} />
                <FeatureProfile items={detail.analysis.featureProfile} />
                <div className="space-y-1.5 rounded border p-3">
                  <HashText hash={detail.row.audioHash} label="证据音频 SHA-256" full />
                  <p className="text-[11px] text-muted-foreground">
                    引擎 {detail.row.engineVersion} · 信道模式：{detail.row.channel === "narrowband" ? "窄带" : "宽带"}
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={openInWorkbench}>
                    <Printer className="h-3.5 w-3.5" aria-hidden /> 在工作台打开并导出核验报告
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border px-3 py-2">
      <div className="font-mono-data text-sm font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
