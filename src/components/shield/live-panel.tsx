"use client";

/**
 * 声盾 — 实时鉴听面板
 * 麦克风 → 16kHz 采集 → 滑动窗口流式分析（客户端 ShieldEar 引擎）
 * → 逐窗置信度曲线 + 高置信告警 → 结束后服务端复核存证
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Mic, MicOff, Radio, ShieldAlert, Loader2, FileCheck2 } from "lucide-react";
import { WaveformCanvas } from "./waveform-canvas";
import { LabelBadge, scoreColor } from "./risk-ui";
import { StreamingAnalyzer } from "@/lib/engine/engine";
import { SCORE_THRESHOLDS, type AnalysisResult, type WindowResult } from "@/lib/engine/types";
import { pcmToB64, formatDuration } from "@/lib/client/audio-client";
import { useShield } from "@/lib/store";
import { cn } from "@/lib/utils";

const WORKLET_CODE = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

interface LiveState {
  running: boolean;
  elapsed: number;
  windows: WindowResult[];
  alertActive: boolean;
  alertCount: number;
  lastScore: number;
  submitting: boolean;
  submitted: boolean;
}

export function LivePanel() {
  const { toast } = useToast();
  const setResult = useShield((s) => s.setResult);
  const setView = useShield((s) => s.setView);

  const [state, setState] = useState<LiveState>({
    running: false,
    elapsed: 0,
    windows: [],
    alertActive: false,
    alertCount: 0,
    lastScore: 0,
    submitting: false,
    submitted: false,
  });

  const analyzerRef = useRef<StreamingAnalyzer | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<number>(0);
  const alertEpisodesRef = useRef(0);
  const alertedRef = useRef(false);
  const beepCtxRef = useRef<AudioContext | null>(null);

  const stopAll = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = 0;
    }
    workletNodeRef.current?.port.close();
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    if (scriptNodeRef.current) {
      scriptNodeRef.current.onaudioprocess = null;
      scriptNodeRef.current.disconnect();
      scriptNodeRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);

  const alertBeep = () => {
    try {
      if (!beepCtxRef.current || beepCtxRef.current.state === "closed") {
        beepCtxRef.current = new AudioContext();
      }
      const ctx = beepCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      /* 忽略音频告警失败 */
    }
  };

  const start = async () => {
    if (state.running) return;
    setState((s) => ({ ...s, running: true, submitted: false, windows: [], elapsed: 0, alertCount: 0, alertActive: false, lastScore: 0 }));
    alertedRef.current = false;
    alertEpisodesRef.current = 0;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 16000 });
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      analyzerRef.current = new StreamingAnalyzer();

      const onChunk = (chunk: Float32Array) => {
        analyzerRef.current?.push(chunk);
      };

      // 优先 AudioWorklet，失败回退 ScriptProcessor
      let captured = false;
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const node = new AudioWorkletNode(ctx, "capture-processor");
        node.port.onmessage = (e) => onChunk(e.data as Float32Array);
        source.connect(node);
        // worklet 无需连 destination，但要保持图活跃：连一个零增益
        const mute = ctx.createGain();
        mute.gain.value = 0;
        node.connect(mute).connect(ctx.destination);
        workletNodeRef.current = node;
        captured = true;
      } catch {
        // 回退方案
      }
      if (!captured) {
        const node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => {
          const ch = e.inputBuffer.getChannelData(0);
          onChunk(new Float32Array(ch));
        };
        source.connect(node);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        node.connect(mute).connect(ctx.destination);
        scriptNodeRef.current = node;
      }

      // 每秒轮询新窗口
      timerRef.current = window.setInterval(() => {
        const az = analyzerRef.current;
        if (!az) return;
        const { all } = az.poll();
        const voiced = all.filter((w) => w.voiced);
        const last = voiced[voiced.length - 1];
        const alertNow =
          !!last && last.score >= SCORE_THRESHOLDS.alert;
        if (alertNow && !alertedRef.current) {
          alertedRef.current = true;
          alertEpisodesRef.current += 1;
          alertBeep();
          toast({
            title: "⚠ 检测到疑似 AI 合成语音片段",
            description: `置信度 ${(last.score * 100).toFixed(1)}%（窗口 ${last.startSec.toFixed(0)}s–${last.endSec.toFixed(0)}s），建议立即提高警惕`,
            variant: "destructive",
          });
        } else if (!alertNow) {
          alertedRef.current = false;
        }
        setState((s) => ({
          ...s,
          windows: all,
          elapsed: az.recordedSamples / 16000,
          alertActive: alertNow,
          alertCount: alertEpisodesRef.current,
          lastScore: last ? last.score : s.lastScore,
        }));
      }, 1000);
    } catch (err) {
      setState((s) => ({ ...s, running: false }));
      toast({
        title: "无法访问麦克风",
        description:
          err instanceof Error && err.name === "NotAllowedError"
            ? "浏览器已拒绝麦克风权限，请在地址栏允许后重试"
            : "未找到可用麦克风设备，可改用「文件检测」模式",
        variant: "destructive",
      });
    }
  };

  const finish = async () => {
    if (!state.running || !analyzerRef.current) return;
    setState((s) => ({ ...s, running: false, submitting: true }));
    const analyzer = analyzerRef.current;
    if (!analyzer) return;
    analyzer.poll(); // 处理已完成的整窗
    const localResult: AnalysisResult = analyzer.finalize();
    const totalSamples = analyzer.recordedSamples;
    stopAll();

    // 本地证据 WAV：直接由引擎录制 PCM 构建
    const pcm = new Float32Array(totalSamples);
    // StreamingAnalyzer 不暴露原始 PCM；以窗口重建（首窗起点 0，连续）
    // 为保证哈希与服务端复核一致，这里重新以 Int16 上行全部采样
    // —— 通过 analyzer 内部缓冲提取
    const internal = analyzer as unknown as { samples: Float32Array };
    pcm.set(internal.samples.subarray(0, totalSamples));
    analyzerRef.current = null;

    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pcmB64: pcmToB64(pcm),
          sourceType: "LIVE",
          sourceLabel: "实时鉴听 · 麦克风",
          notes: "客户端流式初判 + 服务端复核存证",
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "服务端复核失败");
      setResult(
        data.analysis as AnalysisResult,
        {
          caseNo: data.caseNo,
          createdAt: data.createdAt,
          audioHash: data.audioHash,
          sourceHash: null,
          sourceType: "LIVE",
          sourceLabel: "实时鉴听",
          durationSec: data.analysis.audio.durationSec,
          engineVersion: data.analysis.engine.version,
          rtf: data.analysis.stats.rtf,
        },
        null
      );
      setState((s) => ({ ...s, submitting: false, submitted: true }));
      setView("workbench");
      toast({
        title: "鉴听完成，已生成核验报告",
        description: `案件编号 ${data.caseNo} · ${data.analysis.overall.verdict}`,
      });
    } catch (err) {
      // 服务端失败时退回本地结果（无存证）
      setResult(localResult, null, null);
      setState((s) => ({ ...s, submitting: false }));
      toast({
        title: "服务端存证失败",
        description: `${err instanceof Error ? err.message : "网络异常"}，已展示客户端初判结果（未存证）`,
        variant: "destructive",
      });
    }
  };

  const recent = state.windows.filter((w) => w.voiced).slice(-40);
  const lastVoiced = state.windows.filter((w) => w.voiced).slice(-1)[0];

  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden">
        <div className="radar-sweep pointer-events-none absolute inset-0" aria-hidden />
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio
                  className={cn(
                    "h-4 w-4",
                    state.running ? "text-emerald-400 live-dot" : "text-muted-foreground"
                  )}
                  aria-hidden
                />
                实时鉴听
              </CardTitle>
              <CardDescription>
                麦克风接入后边通话边检测，逐窗输出合成置信度，检出即告警
              </CardDescription>
            </div>
            <div className="text-right font-mono-data text-xs text-muted-foreground">
              <div>{formatDuration(state.elapsed)}</div>
              <div>{state.windows.length} 窗</div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 波形 */}
          <div className="grid-bg relative h-32 overflow-hidden rounded-lg border bg-black/40">
            <WaveformCanvas analyser={analyserRef.current} active={state.running} className="h-full w-full" />
            {!state.running && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                待机中 — 点击「开始鉴听」接入麦克风（建议直接播放可疑通话外放）
              </div>
            )}
          </div>

          {/* 告警条 */}
          {state.alertActive && (
            <div className="alert-pulse flex items-center gap-2 rounded-lg border border-red-800 bg-red-950/70 px-4 py-3 text-sm font-semibold text-red-300">
              <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
              当前语音疑似 AI 合成 · 置信度 {((lastVoiced?.score ?? 0) * 100).toFixed(1)}%
              <span className="ml-auto font-normal text-red-400/80">
                勿转账 · 勿泄露验证码 · 回拨核实
              </span>
            </div>
          )}

          {/* 实时逐窗曲线 */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>逐窗合成置信度（实时）</span>
              <span className="font-mono-data">
                最新：{lastVoiced ? (lastVoiced.score * 100).toFixed(1) + "%" : "—"}
                {state.alertCount > 0 && (
                  <span className="ml-2 text-red-400">告警 {state.alertCount} 次</span>
                )}
              </span>
            </div>
            <div className="flex h-16 items-end gap-[3px] rounded-lg border bg-black/30 p-2">
              {recent.length === 0 && (
                <span className="m-auto text-xs text-muted-foreground">等待语音窗口…</span>
              )}
              {recent.map((w) => (
                <div
                  key={w.index}
                  className="w-full min-w-[6px] flex-1 rounded-sm transition-all"
                  style={{
                    height: `${Math.max(4, w.score * 100)}%`,
                    background: scoreColor(w.score),
                    boxShadow: w.score >= SCORE_THRESHOLDS.alert ? "0 0 8px rgba(248,113,113,.7)" : undefined,
                  }}
                  title={`${w.startSec.toFixed(1)}s–${w.endSec.toFixed(1)}s · ${(w.score * 100).toFixed(1)}%`}
                />
              ))}
            </div>
          </div>

          {/* 窗口明细 */}
          {state.windows.length > 0 && (
            <div className="slim-scroll max-h-40 overflow-y-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium">时间轴</th>
                    <th className="px-3 py-1.5 font-medium">置信度</th>
                    <th className="px-3 py-1.5 font-medium">判决</th>
                    <th className="px-3 py-1.5 font-medium">信道</th>
                  </tr>
                </thead>
                <tbody className="font-mono-data">
                  {state.windows
                    .slice()
                    .reverse()
                    .map((w) => (
                      <tr key={w.index} className="border-t">
                        <td className="px-3 py-1.5">
                          {w.startSec.toFixed(1)}–{w.endSec.toFixed(1)}s
                        </td>
                        <td className="px-3 py-1.5">
                          <span style={{ color: scoreColor(w.score) }}>
                            {w.voiced ? (w.score * 100).toFixed(1) + "%" : "静音"}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">{w.voiced ? <LabelBadge label={w.label} /> : "—"}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {w.channel === "narrowband" ? "窄带" : "宽带"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 控制按钮 */}
          <div className="flex flex-wrap items-center gap-3">
            {!state.running ? (
              <Button onClick={start} disabled={state.submitting} className="gap-2">
                {state.submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 服务端复核存证中…
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" aria-hidden /> 开始鉴听
                  </>
                )}
              </Button>
            ) : (
              <Button variant="destructive" onClick={finish} className="gap-2">
                <MicOff className="h-4 w-4" aria-hidden /> 结束并生成核验报告
              </Button>
            )}
            {state.submitting && (
              <div className="flex-1 min-w-[180px] space-y-1">
                <Progress value={80} className="h-1.5" />
                <p className="text-xs text-muted-foreground">
                  正在上传 PCM 至服务端复核（SHA-256 固定 + 案例入库）
                </p>
              </div>
            )}
            {state.submitted && (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                <FileCheck2 className="h-4 w-4" aria-hidden /> 已存证并生成核验报告
              </span>
            )}
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            提示：实时鉴听在浏览器本地完成特征提取与初判，结束后整段 PCM 上传服务端用同一引擎复核并固定哈希 —
            双端一致性是反诈取证可信度的基础。演示建议：外放一段「现场合成挑战」生成的音频，同时开启鉴听。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
