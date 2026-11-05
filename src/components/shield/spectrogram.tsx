"use client";

/**
 * 声盾 — 时频瀑布图（取证级可视化）
 * 客户端 FFT → 对数频率轴热力图，叠加：
 *  · 可疑片段红色高亮区
 *  · 播放进度光标（与内置播放器联动）
 *  · 点击任意时间点跳转播放
 * 全程零联网，纯本地计算
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AudioWaveform, Loader2 } from "lucide-react";
import { hannWindow, magnitudeFrame } from "@/lib/client/fft";
import type { Segment } from "@/lib/engine/types";
import { formatDuration } from "@/lib/client/audio-client";
import { scoreColor } from "./risk-ui";

const FFT_SIZE = 1024;
const HOP = 512;
const F_MIN = 80;
const F_MAX = 7800;

/* Magma 风格色图（黑→紫→品红→橙→亮黄） */
const STOPS: [number, [number, number, number]][] = [
  [0.0, [8, 6, 20]],
  [0.22, [74, 16, 120]],
  [0.45, [160, 42, 130]],
  [0.68, [232, 92, 112]],
  [0.85, [251, 148, 96]],
  [1.0, [253, 254, 200]],
];

function colormap(v: number): [number, number, number] {
  if (v <= 0) return STOPS[0][1];
  if (v >= 1) return STOPS[STOPS.length - 1][1];
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [p0, c0] = STOPS[i - 1];
      const [p1, c1] = STOPS[i];
      const t = (v - p0) / (p1 - p0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

const FREQ_LABELS = [8000, 4000, 2000, 1000, 500, 250, 125];

interface Props {
  audioUrl: string | null;
  durationSec: number;
  segments: Segment[];
  sampleRate?: number;
}

export function SpectrogramCard({ audioUrl, durationSec, segments, sampleRate = 16000 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [progress, setProgress] = useState(0); // 0-1 计算进度
  const [computing, setComputing] = useState(false);
  const [ready, setReady] = useState(false);
  const [playhead, setPlayhead] = useState(0); // 0-1 播放位置

  // 频率 → 像素行（对数轴，顶部为高频）
  const binHz = sampleRate / FFT_SIZE;
  const frames = useMemo(
    () => Math.max(1, Math.floor((durationSec * sampleRate - FFT_SIZE) / HOP) + 1),
    [durationSec, sampleRate]
  );

  /** 分块计算时频矩阵并绘制（不阻塞主线程） */
  const compute = useCallback(async () => {
    if (!audioUrl || !canvasRef.current) return;
    setComputing(true);
    setReady(false);
    setProgress(0);
    try {
      const buf = await fetch(audioUrl).then((r) => r.arrayBuffer());
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor({ sampleRate });
      const decoded = await ctx.decodeAudioData(buf);
      const samples =
        decoded.numberOfChannels > 1
          ? mixToMono(decoded.getChannelData(0), decoded.getChannelData(1))
          : decoded.getChannelData(0);
      void ctx.close();

      const win = hannWindow(FFT_SIZE);
      const re = new Float32Array(FFT_SIZE);
      const im = new Float32Array(FFT_SIZE);

      const canvas = canvasRef.current;
      const W = 960;
      const H = 320;
      canvas.width = W;
      canvas.height = H;
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;
      ctx2d.fillStyle = "#05070c";
      ctx2d.fillRect(0, 0, W, H);

      const img = ctx2d.createImageData(W, H);
      const data = img.data;
      let frame = 0;
      const colFrame = new Float32Array(Math.floor(W / 2)); // 缓存最近一列的帧数据
      void colFrame;

      const step = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

      // 逐列绘制：每列取对应时间帧的频谱，按对数频率轴展开到像素行
      for (let x = 0; x < W; x++) {
        const t = (x / (W - 1)) * durationSec;
        const frameIdx = Math.min(frames - 1, Math.floor((t * sampleRate) / HOP));
        const mag = magnitudeFrame(samples, frameIdx * HOP, FFT_SIZE, win, re, im);

        for (let y = 0; y < H; y++) {
          // 像素行 → 频率（对数）
          const frac = 1 - y / (H - 1); // 顶部=1
          const f = F_MIN * Math.pow(F_MAX / F_MIN, frac);
          const b0 = Math.max(1, Math.floor(f * 0.94 / binHz));
          const b1 = Math.min(mag.length - 1, Math.ceil(f * 1.06 / binHz));
          let v = 0;
          for (let b = b0; b <= b1; b++) if (mag[b] > v) v = mag[b];
          // 轻微伽马提升低能量可视性
          const [r, g, bl] = colormap(Math.pow(v, 0.85));
          const idx = (y * W + x) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = bl;
          data[idx + 3] = 255;
        }
        if (x % 60 === 0) {
          setProgress(x / W);
          await step();
        }
      }
      ctx2d.putImageData(img, 0, 0);
      setProgress(1);
      setReady(true);
    } catch {
      setProgress(0);
    } finally {
      setComputing(false);
    }
  }, [audioUrl, durationSec, frames, sampleRate]);

  useEffect(() => {
    void compute();
  }, [compute]);

  // 播放进度联动（rAF + timeupdate 双保险）
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let raf = 0;
    const loop = () => {
      if (audio.duration > 0) setPlayhead(audio.currentTime / audio.duration);
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const onPause = () => {
      cancelAnimationFrame(raf);
      if (audio.duration > 0) setPlayhead(audio.currentTime / audio.duration);
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    return () => {
      cancelAnimationFrame(raf);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
    };
  }, [ready]);

  // 点击跳转
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const el = overlayRef.current;
    if (!audio || !el || !durationSec) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * durationSec;
    setPlayhead(ratio);
    void audio.play();
  };

  const tone = scoreColor(0.9);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AudioWaveform className="h-4 w-4 text-primary" aria-hidden /> 时频分析 · 取证视图
        </CardTitle>
        <CardDescription>
          短时傅里叶变换（{FFT_SIZE} 点 FFT / 汉宁窗 / {HOP} 点步进）·
          横轴时间 · 纵轴对数频率 · 亮度=能量密度 ·{" "}
          <span style={{ color: tone }}>红色区段=引擎判定的可疑片段</span> · 点击图面任意位置跳转播放
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          {/* 频率轴 */}
          <div className="relative w-9 shrink-0">
            <div className="absolute inset-0 font-mono-data text-[9px] leading-none text-muted-foreground">
              {FREQ_LABELS.map((f) => {
                const frac = Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN);
                const top = (1 - frac) * 100;
                return (
                  <span
                    key={f}
                    className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
                    style={{ top: `${top}%` }}
                  >
                    {f >= 1000 ? `${f / 1000}k` : f}Hz
                  </span>
                );
              })}
            </div>
          </div>

          {/* 主画布区 */}
          <div className="relative min-w-0 flex-1">
            <div
              ref={overlayRef}
              className="relative aspect-[3/1] w-full cursor-crosshair overflow-hidden rounded-md border bg-black/60"
              onClick={seek}
              role="slider"
              aria-label="时频图播放位置，点击跳转"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(playhead * 100)}
              tabIndex={0}
              onKeyDown={(e) => {
                const audio = audioRef.current;
                if (!audio) return;
                if (e.key === "ArrowRight") audio.currentTime = Math.min(audio.duration ?? 0, audio.currentTime + 2);
                if (e.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 2);
              }}
            >
              <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

              {/* 计算中遮罩 */}
              {computing && (
                <div className="absolute inset-0 grid place-items-center bg-black/70 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
                    <span className="font-mono-data text-xs text-primary">
                      正在计算时频矩阵… {(progress * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              )}

              {/* 可疑片段高亮 */}
              {ready &&
                durationSec > 0 &&
                segments.map((s, i) => (
                  <div
                    key={i}
                    className="absolute inset-y-0 border-x-2 border-red-500/70 bg-red-500/12"
                    style={{
                      left: `${(s.startSec / durationSec) * 100}%`,
                      width: `${Math.max(0.8, ((s.endSec - s.startSec) / durationSec) * 100)}%`,
                    }}
                    title={`可疑片段 ${i + 1}：${s.startSec.toFixed(1)}s–${s.endSec.toFixed(1)}s · 均值 ${(s.meanScore * 100).toFixed(0)}%`}
                  >
                    <span className="absolute -top-0 left-0.5 rounded-br bg-red-500/85 px-1 font-mono-data text-[9px] font-bold text-white">
                      {i + 1}
                    </span>
                  </div>
                ))}

              {/* 播放光标 */}
              {ready && (
                <div
                  className="pointer-events-none absolute inset-y-0 w-[2px] bg-white/90"
                  style={{
                    left: `${playhead * 100}%`,
                    boxShadow: "0 0 10px rgba(255,255,255,0.9), 0 0 22px rgba(52,211,153,0.5)",
                  }}
                >
                  <div className="absolute -top-px left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-white" />
                </div>
              )}
            </div>

            {/* 时间轴 */}
            <div className="mt-1 flex justify-between font-mono-data text-[10px] text-muted-foreground">
              <span>0:00</span>
              <span>{formatDuration(durationSec / 2)}</span>
              <span>{formatDuration(durationSec)}</span>
            </div>
          </div>
        </div>

        {/* 播放器（从结果区上移入，与光标联动） */}
        {audioUrl && (
          <audio ref={audioRef} controls src={audioUrl} className="w-full" preload="metadata">
            <track kind="captions" />
          </audio>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          读图指南：自然人声在 300–3400Hz 基频区呈现连续谐波纹理，高频能量稀疏；
          合成语音常见谐波纹理过度平整、高频区出现周期性伪影或能量异常集中 —
          红色高亮区即引擎判定偏离自然分布的可疑时段，可与逐窗置信度曲线交叉印证。
        </p>
      </CardContent>
    </Card>
  );
}

function mixToMono(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
  return out;
}
