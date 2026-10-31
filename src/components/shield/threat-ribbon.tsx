"use client";

/**
 * 声盾 — 实时威胁热力条带（鉴听时的滚动战况时间线）
 * 每完成一个检测窗即落一格：绿=正常 / 琥珀=可疑 / 红=合成
 * 从右向左滚动累积，形成"战况录像带"
 */

import { useEffect, useRef } from "react";
import type { WindowResult } from "@/lib/engine/types";

interface Props {
  windows: WindowResult[];
  running: boolean;
}

const CELL_W = 13; // px per window

export function ThreatRibbon({ windows, running }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const voiced = windows.filter((w) => w.voiced);

  // 新窗口落格时自动滚到最右
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [windows.length]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">
          威胁热力时间线（逐窗落格 · {voiced.length} 个有效窗）
        </span>
        {running && (
          <span className="font-mono-data text-[10px] text-primary">
            <span className="live-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />
            录制中
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="slim-scroll flex h-9 items-center gap-[3px] overflow-x-auto rounded-md border bg-black/40 px-1.5"
      >
        {voiced.length === 0 && (
          <span className="w-full text-center font-mono-data text-[10px] text-muted-foreground">
            等待第一个检测窗…
          </span>
        )}
        {voiced.map((w) => {
          const ratio = Math.max(0.18, w.score);
          const bg =
            w.score >= 0.72
              ? `rgba(248,113,113,${0.35 + ratio * 0.6})`
              : w.score >= 0.5
                ? `rgba(251,191,36,${0.3 + ratio * 0.6})`
                : `rgba(52,211,153,${0.25 + ratio * 0.55})`;
          return (
            <div
              key={w.index}
              className="relative h-[26px] shrink-0 rounded-[3px]"
              style={{ width: CELL_W - 3, background: bg, boxShadow: w.score >= 0.72 ? "0 0 8px rgba(248,113,113,0.5)" : undefined }}
              title={`窗 #${w.index + 1} · ${w.startSec.toFixed(1)}s–${w.endSec.toFixed(1)}s · 置信度 ${(w.score * 100).toFixed(1)}% · ${w.label}`}
            >
              <span className="sr-only">
                窗 {w.index + 1} 置信度 {(w.score * 100).toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 font-mono-data text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "rgba(52,211,153,0.7)" }} /> 正常
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "rgba(251,191,36,0.75)" }} /> 可疑
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "rgba(248,113,113,0.85)" }} /> 合成
        </span>
      </div>
    </div>
  );
}
