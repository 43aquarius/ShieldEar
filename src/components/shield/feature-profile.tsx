"use client";

/**
 * 声盾 — 可解释特征剖面
 * 每个特征：实测均值 vs 自然人声先验区间，z 偏离可视化
 */

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import type { FeatureProfileItem } from "@/lib/engine/types";
import { Info } from "lucide-react";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const ZMAX = 3;

export function FeatureProfile({ items }: { items: FeatureProfileItem[] }) {
  const data = items.map((it) => ({
    name: it.name,
    z: +it.zMean.toFixed(2),
    value: +it.meanValue.toFixed(4),
    prior: +it.naturalPrior.toFixed(4),
    key: it.key as string,
    interpretation: it.interpretation,
  }));

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-3">
        <div style={{ height: Math.max(200, data.length * 34) }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
              <XAxis
                type="number"
                domain={[-ZMAX, ZMAX]}
                tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}σ`}
                stroke="rgba(255,255,255,0.3)"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={110}
                stroke="rgba(255,255,255,0.4)"
                fontSize={12}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(52,211,153,0.06)" }}
                contentStyle={{
                  background: "rgba(20,26,24,0.96)",
                  border: "1px solid rgba(52,211,153,0.3)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number | string) => [`${value}σ`, "偏离自然先验"]}
              />
              <Bar dataKey="z" radius={[0, 3, 3, 0]} barSize={14} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell
                    key={d.key}
                    fill={
                      Math.abs(d.z) < 0.5
                        ? "#34d399"
                        : Math.abs(d.z) < 1.5
                          ? "#fbbf24"
                          : "#f87171"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2">
          {data.map((d) => (
            <div key={d.key} className="flex items-start gap-1.5 rounded border px-2.5 py-1.5 text-xs">
              <span className="font-medium">{d.name}</span>
              <span className="font-mono-data text-muted-foreground">
                实测 {d.value} / 先验 {d.prior}
              </span>
              <UiTooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" aria-label={`${d.name}说明`}>
                    <Info className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  <p>{d.interpretation}</p>
                </TooltipContent>
              </UiTooltip>
            </div>
          ))}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          每个条目表示该声学特征相对「同信道自然人声统计先验」的偏离程度（σ 为自然波动单位）。
          绿色 = 符合自然规律，黄色 = 轻度偏离，红色 = 显著偏离（指向合成来源）。
          声盾的每一个判决都可逐特征追溯 — 这是反诈取证对可解释性的要求。
        </p>
      </div>
    </TooltipProvider>
  );
}
