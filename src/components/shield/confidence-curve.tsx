"use client";

/**
 * 声盾 — 逐窗置信度曲线（2s 窗口 / 1s 步进 / 50% 重叠）
 */
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { WindowResult } from "@/lib/engine/types";
import { scoreColor } from "./risk-ui";

interface Props {
  windows: WindowResult[];
  height?: number;
}

export function ConfidenceCurve({ windows, height = 260 }: Props) {
  const voiced = windows.filter((w) => w.voiced);
  const data = voiced.map((w) => ({
    t: w.startSec,
    score: +(w.score * 100).toFixed(1),
    raw: +(w.rawScore * 100).toFixed(1),
    end: w.endSec,
    label: w.label,
  }));

  if (!data.length) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        未检出有效语音窗口
      </div>
    );
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -14 }}>
          <defs>
            <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
              <stop offset="70%" stopColor="#34d399" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v: number) => `${v.toFixed(0)}s`}
            stroke="rgba(255,255,255,0.3)"
            fontSize={11}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            stroke="rgba(255,255,255,0.3)"
            fontSize={11}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(20,26,24,0.95)",
              border: "1px solid rgba(52,211,153,0.3)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v: number) => `窗口起点 ${v}s`}
            formatter={(value: number | string, name: string) => [
              `${value}%`,
              name === "score" ? "平滑置信度" : "原始置信度",
            ]}
          />
          <ReferenceLine
            y={72}
            stroke="#f87171"
            strokeDasharray="6 3"
            label={{ value: "合成阈值 72%", fill: "#f87171", fontSize: 10, position: "insideTopRight" }}
          />
          <ReferenceLine
            y={50}
            stroke="#fbbf24"
            strokeDasharray="4 3"
            label={{ value: "可疑阈值 50%", fill: "#fbbf24", fontSize: 10, position: "insideTopRight" }}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke="#34d399"
            strokeWidth={2}
            fill="url(#scoreFill)"
            dot={(props: { cx?: number; cy?: number; payload?: { score: number } }) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null || !payload) return <g key={0} />;
              return (
                <circle
                  key={`${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r={2.6}
                  fill={scoreColor(payload.score / 100)}
                />
              );
            }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
