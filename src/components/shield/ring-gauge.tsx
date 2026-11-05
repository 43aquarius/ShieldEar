"use client";

/**
 * 声盾 — 环形置信度仪表（判决剧场主角）
 * SVG 双环：外圈刻度环 + 内圈进度弧（动画描边）
 * 中心：count-up 百分比 + 风险文案 + 风险色发光
 */

import { useEffect, useState } from "react";
import { useCountUp } from "./use-count-up";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/lib/engine/types";

const RISK_RING: Record<string, { stroke: string; glow: string; tick: string }> = {
  LOW: { stroke: "#34d399", glow: "rgba(52,211,153,0.55)", tick: "rgba(52,211,153,0.28)" },
  MEDIUM: { stroke: "#fbbf24", glow: "rgba(251,191,36,0.55)", tick: "rgba(251,191,36,0.28)" },
  HIGH: { stroke: "#fb923c", glow: "rgba(251,146,60,0.55)", tick: "rgba(251,146,60,0.28)" },
  CRITICAL: { stroke: "#f87171", glow: "rgba(248,113,113,0.6)", tick: "rgba(248,113,113,0.3)" },
};

const SIZE = 172;
const R = 68;
const C = 2 * Math.PI * R;

interface Props {
  /** 合成置信度 0-1 */
  value: number;
  risk: RiskLevel | string;
  /** 主标签（如 "合成置信度"） */
  label?: string;
  /** 副文案（判决短语） */
  caption?: string;
  className?: string;
}

export function RingGauge({ value, risk, label = "合成置信度", caption, className }: Props) {
  const meta = RISK_RING[risk as string] ?? RISK_RING.LOW;
  const animated = useCountUp(value, { duration: 1200, delay: 260 });
  // 刻度环逐格点亮（600ms 内扫过）
  const [litTicks, setLitTicks] = useState(0);

  useEffect(() => {
    let raf = 0;
    let start = 0;
    const total = 40;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / 620);
      setLitTicks(Math.round(total * t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, 60);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, []);

  const pct = animated * 100;
  const danger = risk === "HIGH" || risk === "CRITICAL";

  return (
    <div
      className={cn("relative select-none", className)}
      role="img"
      aria-label={`${label} ${pct.toFixed(1)}%`}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={cn("gauge-breathe", danger && "animate-none")}
        style={danger ? { filter: `drop-shadow(0 0 12px ${meta.glow})` } : undefined}
      >
        <defs>
          <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={meta.stroke} stopOpacity="0.75" />
            <stop offset="100%" stopColor={meta.stroke} />
          </linearGradient>
        </defs>

        {/* 背景轨道 */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="10"
        />

        {/* 外圈刻度：40 格，逐格点亮 */}
        {Array.from({ length: 40 }).map((_, i) => {
          const a = (i / 40) * Math.PI * 2 - Math.PI / 2;
          const r1 = R + 14;
          const r2 = R + 19;
          const lit = i < litTicks;
          return (
            <line
              key={i}
              x1={SIZE / 2 + Math.cos(a) * r1}
              y1={SIZE / 2 + Math.sin(a) * r1}
              x2={SIZE / 2 + Math.cos(a) * r2}
              y2={SIZE / 2 + Math.sin(a) * r2}
              stroke={lit ? meta.tick : "rgba(255,255,255,0.05)"}
              strokeWidth="2"
              strokeLinecap="round"
            />
          );
        })}

        {/* 进度弧（从 -90° 起顺时针） */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${animated * C} ${C}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />

        {/* 端点光珠 */}
        {animated > 0.02 && (
          <circle
            cx={SIZE / 2 + Math.cos(-Math.PI / 2 + animated * Math.PI * 2) * R}
            cy={SIZE / 2 + Math.sin(-Math.PI / 2 + animated * Math.PI * 2) * R}
            r="5.5"
            fill="#fff"
            stroke={meta.stroke}
            strokeWidth="3"
            style={{ filter: `drop-shadow(0 0 6px ${meta.glow})` }}
          />
        )}
      </svg>

      {/* 中心读数 */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div
          className="font-mono-data text-[34px] font-bold leading-none tabular-nums"
          style={{ color: meta.stroke, textShadow: `0 0 18px ${meta.glow}` }}
        >
          {pct.toFixed(1)}
          <span className="ml-0.5 text-base font-medium opacity-70">%</span>
        </div>
        <div className="mt-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
          {label}
        </div>
        {caption && (
          <div
            className="mt-1 max-w-[120px] text-center text-[11px] font-semibold leading-tight"
            style={{ color: meta.stroke }}
          >
            {caption}
          </div>
        )}
      </div>
    </div>
  );
}
