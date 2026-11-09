"use client";

/**
 * 声盾 — 系统自检视图（v1.3.5）
 * ────────────────────────────────
 * 一键体检：数据引擎 / 证据目录 / 引擎校准 / 离线声明。
 * 逐项揭晓动画（转圈 → 打勾），全绿收尾。答辩开场仪式感：
 * "演示之前，先向评委证明这台机器上的声盾是健康的、离线的。"
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { fetchJson } from "@/lib/client/safe-json";
import { cn } from "@/lib/utils";
import {
  Activity,
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  CloudOff,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";

interface CheckItem {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

interface SelfCheckReport {
  engineVersion: string;
  releaseOffline: boolean;
  platform: string;
  nodeVersion: string;
  checks: CheckItem[];
  passed: number;
  total: number;
  allOk: boolean;
  checkedAt: string;
  error?: string;
}

/** 每项揭晓间隔（毫秒），营造逐项扫描的仪式感 */
const REVEAL_STEP_MS = 320;

export function SelfCheckView() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SelfCheckReport | null>(null);
  /** 已揭晓到第几项（-1 = 未开始） */
  const [revealed, setRevealed] = useState(-1);

  const run = async () => {
    setBusy(true);
    setReport(null);
    setRevealed(-1);
    try {
      const r = await fetchJson<SelfCheckReport>("/api/selfcheck");
      setReport(r);
      // 逐项揭晓
      for (let i = 0; i < r.checks.length; i++) {
        window.setTimeout(() => setRevealed(i), i * REVEAL_STEP_MS);
      }
      const totalMs = r.checks.length * REVEAL_STEP_MS + 400;
      window.setTimeout(() => {
        if (r.allOk) {
          toast({ title: "系统自检完成", description: `${r.passed}/${r.total} 项全部通过 · 平台就绪` });
        } else {
          toast({
            title: "自检发现异常",
            description: `${r.passed}/${r.total} 项通过，请查看未通过项的说明`,
            variant: "destructive",
          });
        }
      }, totalMs);
    } catch (err) {
      toast({
        title: "自检请求失败",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
      setBusy(false);
      return;
    }
    window.setTimeout(() => setBusy(false), 600);
  };

  const allRevealed = report !== null && revealed >= report.checks.length - 1;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="relative overflow-hidden rounded-xl border bg-gradient-to-b from-primary/10 to-transparent p-5 sm:p-6">
        <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative">
          <h1 className="flex items-center gap-2 text-2xl font-bold leading-tight">
            <Activity className="h-6 w-6 text-primary" aria-hidden /> 系统自检
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            对声盾各子系统做一次只读体检：数据引擎、证据目录、引擎校准、离线声明。
            全部通过即证明本平台在当前机器上健康运行 — 演示与存证的每一步都建立在可信的运行时之上。
            自检不发出任何网络请求。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={() => void run()} disabled={busy} className="gap-2">
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 自检进行中…
                </>
              ) : report ? (
                <>
                  <RotateCcw className="h-4 w-4" aria-hidden /> 重新自检
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" aria-hidden /> 开始自检
                </>
              )}
            </Button>
            {report && (
              <Badge variant="outline" className="gap-1 font-mono-data text-[11px]">
                {report.engineVersion} · node {report.nodeVersion} · {report.platform}
              </Badge>
            )}
            {report?.releaseOffline && (
              <Badge variant="outline" className="gap-1 border-sky-500/40 text-[11px] text-sky-400">
                <CloudOff className="h-3 w-3" aria-hidden /> 纯离线发行版
              </Badge>
            )}
          </div>
        </div>
      </section>

      {/* 未开始 */}
      {!report && !busy && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-full border border-dashed border-primary/40 bg-primary/5">
              <ShieldCheck className="h-8 w-8 text-primary/70" aria-hidden />
            </div>
            <div className="text-sm text-muted-foreground">
              点击「开始自检」，逐项验证平台各子系统状态
            </div>
          </CardContent>
        </Card>
      )}

      {/* 逐项清单 */}
      {report && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">自检结果</CardTitle>
            <CardDescription>
              {report.checks.length} 个子系统 · {new Date(report.checkedAt).toLocaleString("zh-CN")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {report.checks.map((c, i) => {
              const isRevealed = i <= revealed;
              return (
                <div
                  key={c.name}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 transition-all duration-300",
                    !isRevealed && "translate-y-1 opacity-0",
                    isRevealed && (c.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5")
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    {!isRevealed ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                    ) : c.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{c.name}</span>
                      {isRevealed && (
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 font-mono-data text-[10px]",
                            c.ok ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400"
                          )}
                        >
                          {c.ok ? "PASS" : "FAIL"} · {c.ms}ms
                        </span>
                      )}
                    </div>
                    {isRevealed && (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{c.detail}</p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* 总结横幅 */}
            <div
              className={cn(
                "mt-4 flex items-center justify-between gap-3 rounded-lg border-2 p-4 transition-all duration-500",
                !allRevealed && "translate-y-2 opacity-0",
                allRevealed && report.allOk
                  ? "border-emerald-500/60 bg-emerald-500/10"
                  : "border-red-500/60 bg-red-500/10"
              )}
            >
              <div className="flex items-center gap-3">
                {allRevealed &&
                  (report.allOk ? (
                    <ShieldCheck className="h-8 w-8 text-emerald-400" aria-hidden />
                  ) : (
                    <XCircle className="h-8 w-8 text-red-400" aria-hidden />
                  ))}
                <div>
                  <div className={cn("text-base font-bold", report.allOk ? "text-emerald-400" : "text-red-400")}>
                    {report.allOk
                      ? `${report.passed}/${report.total} 全部通过 · 系统就绪`
                      : `${report.passed}/${report.total} 通过 · 存在异常项`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {report.allOk
                      ? "各子系统运行正常，可开始演示：合成 → 鉴听告警 → 存证 → 核验"
                      : "请根据未通过项的说明检查环境；常见原因为包不完整或权限不足"}
                  </div>
                </div>
              </div>
              {report.releaseOffline && allRevealed && (
                <Badge variant="outline" className="hidden shrink-0 gap-1 border-sky-500/40 text-sky-400 sm:flex">
                  <CloudOff className="h-3 w-3" aria-hidden /> 零联网运行
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
