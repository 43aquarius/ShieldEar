/**
 * 声盾 — 风险等级与标签的统一展示工具
 */
import { cn } from "@/lib/utils";
import type { RiskLevel, WindowLabel } from "@/lib/engine/types";

export const RISK_META: Record<
  RiskLevel,
  { label: string; color: string; badge: string; desc: string }
> = {
  LOW: {
    label: "未发现合成特征",
    color: "text-emerald-400",
    badge: "bg-emerald-950/80 text-emerald-300 border-emerald-800",
    desc: "声学特征与自然人声相符",
  },
  MEDIUM: {
    label: "存在可疑片段",
    color: "text-amber-400",
    badge: "bg-amber-950/80 text-amber-300 border-amber-800",
    desc: "部分时段特征异常",
  },
  HIGH: {
    label: "疑似 AI 合成",
    color: "text-orange-400",
    badge: "bg-orange-950/80 text-orange-300 border-orange-800",
    desc: "持续性声学特征异常",
  },
  CRITICAL: {
    label: "高度疑似 AI 合成",
    color: "text-red-400",
    badge: "bg-red-950/80 text-red-300 border-red-800",
    desc: "多维度显著偏离自然规律",
  },
};

export const LABEL_META: Record<WindowLabel, { label: string; badge: string }> = {
  silent: { label: "静音", badge: "bg-zinc-800/80 text-zinc-400 border-zinc-700" },
  natural: { label: "正常", badge: "bg-emerald-950/80 text-emerald-300 border-emerald-800" },
  suspect: { label: "可疑", badge: "bg-amber-950/80 text-amber-300 border-amber-800" },
  synthetic: { label: "合成", badge: "bg-red-950/80 text-red-300 border-red-800" },
};

export function RiskBadge({
  risk,
  className,
}: {
  risk: RiskLevel | string;
  className?: string;
}) {
  const m = RISK_META[(risk as RiskLevel) in RISK_META ? (risk as RiskLevel) : "LOW"];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold",
        m.badge,
        className
      )}
    >
      {risk === "CRITICAL" && (
        <span className="h-1.5 w-1.5 rounded-full bg-red-400 live-dot" aria-hidden />
      )}
      {m.label}
    </span>
  );
}

export function LabelBadge({ label }: { label: WindowLabel | string }) {
  const m = LABEL_META[label as WindowLabel] ?? LABEL_META.natural;
  return (
    <span className={cn("inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium", m.badge)}>
      {m.label}
    </span>
  );
}

export function scoreColor(score: number): string {
  if (score >= 0.72) return "#f87171";
  if (score >= 0.5) return "#fbbf24";
  return "#34d399";
}
