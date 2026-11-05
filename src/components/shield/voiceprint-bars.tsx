"use client";

/**
 * 声盾 — Hero 声纹律动画布
 * 无麦克风也可运行的有机律动（多频正弦叠加 + 随机脉动），
 * 营造"系统活着"的第一眼印象；麦克风开启时可复用为真实声纹
 */

import { useEffect, useRef } from "react";

interface Props {
  active?: boolean;
  className?: string;
  /** 条颜色（CSS 色），默认主题翠 */
  color?: string;
}

export function VoiceprintBars({ active = true, className, color = "#34d399" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const phaseRef = useRef(0);
  // 每根条的独立随机相位与频率，避免机械感
  const seedsRef = useRef<{ p: number; f: number; a: number }[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (time: number) => {
      rafRef.current = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      if (!active) {
        ctx.fillStyle = "rgba(52,211,153,0.10)";
        const bw = 3 * dpr;
        for (let x = 0; x < W; x += bw * 2.6) {
          ctx.fillRect(x, H / 2 - 1.5 * dpr, bw, 3 * dpr);
        }
        return;
      }

      phaseRef.current += 0.016;
      const phase = phaseRef.current;
      const gap = 3 * dpr;
      const bw = Math.max(2 * dpr, Math.floor((W / 90) - gap));
      const n = Math.floor(W / (bw + gap));

      if (seedsRef.current.length !== n) {
        seedsRef.current = Array.from({ length: n }, (_, i) => ({
          p: Math.random() * Math.PI * 2,
          f: 0.6 + Math.random() * 1.8,
          a: 0.35 + Math.random() * 0.65,
        }));
      }

      for (let i = 0; i < n; i++) {
        const s = seedsRef.current[i];
        // 中心加权：靠近中间的条更高，形成声纹纺锤形
        const cx = Math.abs(i / (n - 1) - 0.5) * 2; // 0 中心 → 1 边缘
        const env = Math.pow(1 - cx, 1.4) * 0.85 + 0.15;
        // 三层正弦叠加 + 行波
        const v =
          0.42 * Math.sin(phase * s.f + s.p) +
          0.3 * Math.sin(phase * s.f * 2.17 + i * 0.35) +
          0.28 * Math.sin(phase * 0.8 + i * 0.12);
        const level = Math.max(0.04, Math.abs(v) * env * s.a);
        const h = level * H * 0.92;
        const x = i * (bw + gap);
        const y = (H - h) / 2;

        // 亮度随高度提升
        const li = Math.min(1, level * 1.35);
        ctx.fillStyle = withAlpha(color, 0.25 + li * 0.65);
        if (li > 0.72) {
          ctx.shadowColor = withAlpha(color, 0.55);
          ctx.shadowBlur = 7 * dpr;
        } else {
          ctx.shadowBlur = 0;
        }
        const r = Math.min(bw / 2, 2 * dpr);
        roundRect(ctx, x, y, bw, h, r);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      void time;
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [active, color]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={active ? "声盾声纹律动" : "声纹待机"}
    />
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function withAlpha(hex: string, a: number): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}
