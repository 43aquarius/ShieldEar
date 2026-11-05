"use client";

/**
 * 声盾 — 证据完整性核验印章（v1.3.5）
 * ────────────────────────────────────────
 * 一键核验：服务端重读证据 WAV → 重算 SHA-256 → 与入库哈希比对。
 * 通过 → 绿色「证据链完整」圆章砸落；失配 → 红色「核验未通过」警示章。
 * "存证 → 验真"闭环的验真端：证明证据自入库以来未被篡改。
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { fetchJson } from "@/lib/client/safe-json";
import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  ShieldX,
  Loader2,
  Fingerprint,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";

interface IntegrityCheck {
  name: string;
  status: "ok" | "fail" | "skipped";
  detail: string;
}

interface IntegrityReport {
  caseNo: string;
  verified: boolean;
  checks: IntegrityCheck[];
  storedAudioHash: string;
  recomputedAudioHash: string | null;
  evidenceBytes: number | null;
  checkedAt: string;
  durationMs: number;
  error?: string;
}

const STATUS_ICON = {
  ok: <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />,
  fail: <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden />,
  skipped: <MinusCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />,
};

export function IntegritySeal({ caseNo, compact = false }: { caseNo: string; compact?: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<IntegrityReport | null>(null);

  const run = async () => {
    setBusy(true);
    setReport(null);
    try {
      const r = await fetchJson<IntegrityReport>(`/api/verify/${encodeURIComponent(caseNo)}`);
      setReport(r);
      if (r.verified) {
        toast({
          title: "证据链核验通过",
          description: `${caseNo} · 证据音频 SHA-256 重算一致，未被篡改（${r.durationMs}ms）`,
        });
      } else {
        toast({
          title: "证据链核验未通过",
          description: "证据与入库哈希不一致，可能被篡改或损坏",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "核验请求失败",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={busy} className="gap-2">
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> 核验中…
            </>
          ) : (
            <>
              <Fingerprint className="h-3.5 w-3.5" aria-hidden /> 核验证据完整性
            </>
          )}
        </Button>
        <span className="text-[11px] leading-relaxed text-muted-foreground">
          重读证据音频并重算 SHA-256，与入库值比对 — 验证证据自存证以来未被篡改
        </span>
      </div>

      {report && (
        <div
          className={cn(
            "flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start",
            report.verified
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-red-500/40 bg-red-500/5"
          )}
        >
          {/* 核验印章 */}
          <div className="flex shrink-0 items-center justify-center sm:w-32">
            <div
              className={cn(
                "stamp-slam grid h-24 w-24 place-items-center rounded-full border-[3px] double-line",
                report.verified
                  ? "border-emerald-400/80 text-emerald-400"
                  : "border-red-400/80 text-red-400"
              )}
              style={{ background: report.verified ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)" }}
            >
              <div className="text-center leading-tight">
                {report.verified ? (
                  <ShieldCheck className="mx-auto h-6 w-6" aria-hidden />
                ) : (
                  <ShieldX className="mx-auto h-6 w-6" aria-hidden />
                )}
                <div className="mt-1 text-[13px] font-bold tracking-wider">
                  {report.verified ? "证据链完整" : "核验未通过"}
                </div>
                <div className="font-mono-data text-[8px] opacity-70">
                  {report.verified ? "INTEGRITY VERIFIED" : "INTEGRITY FAILED"}
                </div>
              </div>
            </div>
          </div>

          {/* 逐项结果 */}
          <div className="min-w-0 flex-1 space-y-1.5">
            {report.checks.map((c) => (
              <div key={c.name} className="flex items-start gap-2 text-xs">
                {STATUS_ICON[c.status]}
                <span className="min-w-0">
                  <span
                    className={cn(
                      "font-medium",
                      c.status === "fail" ? "text-red-400" : c.status === "ok" ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {c.name}
                  </span>
                  <span className="text-muted-foreground"> — {c.detail}</span>
                </span>
              </div>
            ))}
            <div className="pt-1 font-mono-data text-[10px] text-muted-foreground">
              核验耗时 {report.durationMs}ms · {new Date(report.checkedAt).toLocaleString("zh-CN")}
              {report.evidenceBytes !== null && ` · 证据 ${(report.evidenceBytes / 1024).toFixed(1)} KB`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
