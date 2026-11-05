"use client";

/**
 * 声盾 — 数字滚动 Hook（rAF 缓动）
 * 结果揭晓时统计数字从 0 平滑滚到目标值，营造仪表读数感
 */

import { useEffect, useRef, useState } from "react";

interface CountUpOptions {
  /** 动画时长（毫秒），默认 1100 */
  duration?: number;
  /** 延迟启动（毫秒），用于入场错峰，默认 0 */
  delay?: number;
  /** 缓动函数，默认 easeOutCubic */
  ease?: (t: number) => number;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function useCountUp(target: number, options: CountUpOptions = {}): number {
  const { duration = 1100, delay = 0, ease = easeOutCubic } = options;
  const [value, setValue] = useState(0);
  // 目标变化时重置（同一结果面板换数据也能重新滚一遍）
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let start = 0;
    let timer = 0;
    let cancelled = false;

    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / duration);
      setValue(target * ease(t));
      if (t < 1 && !cancelled) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    const begin = () => {
      rafRef.current = requestAnimationFrame(tick);
    };

    if (delay > 0) {
      timer = window.setTimeout(begin, delay);
    } else {
      begin();
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      if (timer) window.clearTimeout(timer);
    };
  }, [target, duration, delay, ease]);

  return value;
}

/** 格式化百分比（0-1 → "87.3"），滚动中保留一位小数 */
export function formatPct(v: number): string {
  return (v * 100).toFixed(1);
}
