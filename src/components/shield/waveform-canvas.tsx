"use client";

/**
 * 声盾 — 实时波形画布（雷达风格滚动波形）
 */
import { useEffect, useRef } from "react";

interface Props {
  analyser: AnalyserNode | null;
  active: boolean;
  className?: string;
}

export function WaveformCanvas({ analyser, active, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const width = (canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1));
    const height = (canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1));

    let data: Uint8Array | null = null;

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      ctx2d.clearRect(0, 0, width, height);
      // 网格
      ctx2d.strokeStyle = "rgba(52, 211, 153, 0.08)";
      ctx2d.lineWidth = 1;
      for (let x = 0; x < width; x += 28 * (window.devicePixelRatio || 1)) {
        ctx2d.beginPath();
        ctx2d.moveTo(x, 0);
        ctx2d.lineTo(x, height);
        ctx2d.stroke();
      }
      for (let y = 0; y < height; y += 28 * (window.devicePixelRatio || 1)) {
        ctx2d.beginPath();
        ctx2d.moveTo(0, y);
        ctx2d.lineTo(width, y);
        ctx2d.stroke();
      }
      // 中线
      ctx2d.strokeStyle = "rgba(52, 211, 153, 0.25)";
      ctx2d.beginPath();
      ctx2d.moveTo(0, height / 2);
      ctx2d.lineTo(width, height / 2);
      ctx2d.stroke();

      if (!analyser || !active) return;
      if (!data || data.length !== analyser.fftSize) {
        data = new Uint8Array(analyser.fftSize);
      }
      // @ts-expect-error -- 带类型别名的 getByteTimeDomainData 重载
      analyser.getByteTimeDomainData(data);
      // 波形
      ctx2d.strokeStyle = "#34d399";
      ctx2d.lineWidth = 1.6 * (window.devicePixelRatio || 1);
      ctx2d.shadowColor = "rgba(52, 211, 153, 0.65)";
      ctx2d.shadowBlur = 6;
      ctx2d.beginPath();
      const sliceW = width / data.length;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        const y = height / 2 + v * (height / 2) * 0.92;
        if (i === 0) ctx2d.moveTo(0, y);
        else ctx2d.lineTo(i * sliceW, y);
      }
      ctx2d.stroke();
      ctx2d.shadowBlur = 0;
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, active]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={active ? "实时音频波形" : "波形待机"}
    />
  );
}
