"use client";

/**
 * 声盾 — 判决印章（结果揭晓的砸落瞬间）
 * 双线圆章 + 旋转文字，CSS 动画从放大虚影砸到定格
 * 深伪检出（红）/ 真人语音（翠）/ 可疑（琥珀）
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/lib/engine/types";

const STAMP_META: Record<string, { text: string; sub: string; color: string; border: string; bg: string }> = {
  CRITICAL: {
    text: "深伪检出",
    sub: "AI-SYNTHESIZED · CRITICAL",
    color: "#f87171",
    border: "rgba(248,113,113,0.9)",
    bg: "rgba(248,113,113,0.10)",
  },
  HIGH: {
    text: "疑似合成",
    sub: "AI-SYNTHESIZED · HIGH",
    color: "#fb923c",
    border: "rgba(251,146,60,0.9)",
    bg: "rgba(251,146,60,0.10)",
  },
  MEDIUM: {
    text: "存在可疑",
    sub: "SUSPICIOUS · MEDIUM",
    color: "#fbbf24",
    border: "rgba(251,191,36,0.9)",
    bg: "rgba(251,191,36,0.10)",
  },
  LOW: {
    text: "真人语音",
    sub: "HUMAN VERIFIED · LOW RISK",
    color: "#34d399",
    border: "rgba(52,211,153,0.9)",
    bg: "rgba(52,211,153,0.10)",
  },
};

interface Props {
  risk: RiskLevel | string;
  /** 延迟砸落（毫秒），与仪表扫描错峰 */
  delay?: number;
  className?: string;
}

export function VerdictStamp({ risk, delay = 900, className }: Props) {
  const meta = STAMP_META[risk as string] ?? STAMP_META.LOW;
  // delay 后才挂载 → 触发 stamp-slam 动画
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), delay);
    return () => window.clearTimeout(t);
  }, [delay]);

  if (!armed) return null;

  return (
    <div className={cn("pointer-events-none absolute", className)} aria-hidden>
      {/* 砸落闪光 */}
      <div
        className="stamp-flash absolute -inset-8 rounded-full"
        style={{ background: `radial-gradient(circle, ${meta.bg} 0%, transparent 65%)` }}
      />
      <div className="stamp-slam relative">
        <div
          className="grid place-items-center rounded-full border-[3px] px-4 py-2.5 backdrop-blur-[1px]"
          style={{
            borderColor: meta.border,
            backgroundColor: meta.bg,
            boxShadow: `inset 0 0 0 2px ${meta.bg}, inset 0 0 0 3.5px ${meta.border}, 0 0 24px ${meta.bg}`,
          }}
        >
          <div
            className="text-[21px] font-black leading-tight tracking-[0.24em]"
            style={{ color: meta.color, textShadow: `0 0 14px ${meta.bg}` }}
          >
            {meta.text}
          </div>
          <div
            className="mt-0.5 font-mono-data text-[8.5px] font-semibold tracking-[0.16em] opacity-80"
            style={{ color: meta.color }}
          >
            {meta.sub}
          </div>
        </div>
      </div>
    </div>
  );
}
