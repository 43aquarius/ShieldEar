"use client";

/**
 * 声盾 — 真伪 A/B 对比试听
 * 内置对照组样本（公有领域/平台合成），浏览器内现场跑引擎出双判决
 * 演示叙事：耳朵分不清的，声纹分得清
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Ear, Loader2, ShieldCheck, ShieldAlert, User, Bot } from "lucide-react";
import { decodeFileTo16k } from "@/lib/client/audio-client";
import { analyzeBuffer } from "@/lib/engine/engine";
import type { AnalysisResult } from "@/lib/engine/types";
import { RiskBadge } from "./risk-ui";
import { cn } from "@/lib/utils";

const SAMPLES = [
  {
    key: "human",
    url: "/samples/demo_natural_demo.wav",
    title: "A · 真人录音",
    sub: "自然人声样本",
    icon: User,
    tone: "emerald",
    note: "真实人声的自然韵律与气息",
  },
  {
    key: "ai",
    url: "/samples/demo_scam_tongtong.wav",
    title: "B · AI 合成",
    sub: "TTS 克隆语音样本",
    icon: Bot,
    tone: "red",
    note: "同一话术的 AI 合成版本",
  },
] as const;

type Verdict = { ratio: number; risk: string; verdict: string; ms: number };

export function AbCompareCard() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict> | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const out: Record<string, Verdict> = {};
      for (const s of SAMPLES) {
        const blob = await fetch(s.url).then((r) => r.blob());
        const decoded = await decodeFileTo16k(blob);
        const t0 = performance.now();
        const r: AnalysisResult = analyzeBuffer(decoded.pcm);
        out[s.key] = {
          ratio: r.overall.syntheticRatio,
          risk: r.overall.risk,
          verdict: r.overall.verdict,
          ms: performance.now() - t0,
        };
      }
      setVerdicts(out);
      toast({
        title: "双样本引擎判决完成",
        description: "两段音频均在本机浏览器内实时分析 — 试听对比与引擎结论交叉印证",
      });
    } catch {
      toast({
        title: "对比样本加载失败",
        description: "内置样本文件缺失，请检查部署完整性",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Ear className="h-4 w-4 text-primary" aria-hidden /> 真伪 A/B 对比试听
        </CardTitle>
        <CardDescription>
          先用耳朵听 — 两段话术你能分清真人还是 AI 吗？再让引擎当庭对质（浏览器内实时分析，零联网）
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {SAMPLES.map((s) => {
            const v = verdicts?.[s.key];
            return (
              <div
                key={s.key}
                className={cn(
                  "verdict-in space-y-2 rounded-lg border p-3",
                  v
                    ? v.risk === "LOW"
                      ? "border-emerald-800/60 bg-emerald-950/15"
                      : "border-red-800/60 bg-red-950/15"
                    : "border-dashed"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <s.icon
                      className={cn(
                        "h-4 w-4",
                        s.tone === "emerald" ? "text-emerald-400" : "text-red-400"
                      )}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold">{s.title}</span>
                  </div>
                  {v ? (
                    <RiskBadge risk={v.risk} />
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      {s.sub}
                    </Badge>
                  )}
                </div>
                <audio controls src={s.url} className="w-full" preload="metadata">
                  <track kind="captions" />
                </audio>
                {v ? (
                  <div className="verdict-in-2 flex items-center justify-between rounded border bg-black/30 px-2.5 py-1.5">
                    <span className="flex items-center gap-1.5 text-xs">
                      {v.risk === "LOW" ? (
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                      ) : (
                        <ShieldAlert className="h-3.5 w-3.5 text-red-400" aria-hidden />
                      )}
                      <span className="font-medium">{v.verdict}</span>
                    </span>
                    <span className="font-mono-data text-[11px] text-muted-foreground">
                      置信度 {(v.ratio * 100).toFixed(1)}% · {v.ms.toFixed(0)}ms
                    </span>
                  </div>
                ) : (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{s.note}</p>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => void run()} disabled={busy} className="gap-2" variant="secondary">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 引擎分析中…
              </>
            ) : (
              <>
                <ShieldAlert className="h-4 w-4" aria-hidden /> 运行引擎对比
              </>
            )}
          </Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            样本内置交付（不联网）：A 为公有领域真人录音，B 为平台 TTS
            合成的同款话术 — 引擎判决全部在本机浏览器内实时完成
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
