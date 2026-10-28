"use client";

/**
 * 声盾 — 文件检测面板
 * 上传可疑通话录音（mp3/wav/m4a/ogg…）→ 浏览器解码至 16kHz →
 * 服务端 ShieldEar 引擎复核 → 存证 + 核验报告
 * 支持拖拽上传与预置演示样本一键检测
 */

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  UploadCloud,
  FileAudio,
  Loader2,
  FlaskConical,
  FileCheck2,
} from "lucide-react";
import {
  decodeFileTo16k,
  sha256OfBlob,
  pcmToB64,
  b64ToBlobUrl,
  formatDuration,
  MAX_UPLOAD_SEC,
} from "@/lib/client/audio-client";
import type { AnalysisResult } from "@/lib/engine/types";
import { useShield } from "@/lib/store";
import { cn } from "@/lib/utils";

type Stage = "idle" | "decoding" | "hashing" | "uploading" | "analyzing" | "done" | "error";

const STAGE_TEXT: Record<Stage, string> = {
  idle: "等待文件",
  decoding: "浏览器解码 · 混音 · 重采样 16kHz",
  hashing: "计算原始文件 SHA-256",
  uploading: "上传 PCM（Int16 编码）至服务端",
  analyzing: "服务端引擎复核 · 逐窗判决 · 存证入库",
  done: "完成",
  error: "失败",
};

const PRESETS = [
  {
    file: "/samples/demo_scam_tongtong.wav",
    name: "AI 合成 · 冒充亲属诈骗话术（tongtong 音色）",
  },
  {
    file: "/samples/demo_scam_luodo.wav",
    name: "AI 合成 · 冒充亲属诈骗话术（luodo 音色）",
  },
  {
    file: "/samples/demo_natural_viper.wav",
    name: "自然人声对照 · 英文朗读（公有领域）",
  },
];

export function FilePanel() {
  const { toast } = useToast();
  const setResult = useShield((s) => s.setResult);
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const analyzeFile = async (file: File | Blob, name: string, size: number) => {
    setStage("decoding");
    setProgress(10);
    setFileName(name);
    setFileSize(size);
    setPreviewUrl(URL.createObjectURL(file));
    try {
      const { pcm, durationSec } = await decodeFileTo16k(file);
      setDuration(durationSec);
      if (durationSec < 2) {
        throw new Error("音频过短：至少需要 2 秒语音");
      }
      if (durationSec > MAX_UPLOAD_SEC) {
        throw new Error(`音频过长（${durationSec.toFixed(0)}s > ${MAX_UPLOAD_SEC}s），请截取可疑片段`);
      }
      setStage("hashing");
      setProgress(30);
      const sourceHash = await sha256OfBlob(file);

      setStage("uploading");
      setProgress(50);
      const pcmB64 = pcmToB64(pcm);

      setStage("analyzing");
      setProgress(75);
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pcmB64,
          sourceType: "UPLOAD",
          sourceLabel: name,
          fileName: name,
          fileSize: size,
          sourceHash,
          notes: "文件检测 · 服务端引擎复核",
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "服务端分析失败");
      setProgress(100);
      setStage("done");
      setResult(
        data.analysis as AnalysisResult,
        {
          caseNo: data.caseNo,
          createdAt: data.createdAt,
          audioHash: data.audioHash,
          sourceHash: data.sourceHash ?? sourceHash,
          sourceType: "UPLOAD",
          sourceLabel: name,
          fileName: name,
          durationSec: data.analysis.audio.durationSec,
          engineVersion: data.analysis.engine.version,
          rtf: data.analysis.stats.rtf,
        },
        null
      );
      toast({
        title: "检测完成，已存证",
        description: `案件编号 ${data.caseNo} · ${data.analysis.overall.verdict}`,
      });
    } catch (err) {
      setStage("error");
      toast({
        title: "文件检测失败",
        description: err instanceof Error ? err.message : "未知错误",
        variant: "destructive",
      });
    }
  };

  const onPick = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio") && !/\.(wav|mp3|m4a|ogg|flac|aac|opus|webm)$/i.test(file.name)) {
      toast({ title: "请选择音频文件", description: `当前文件类型：${file.type || "未知"}`, variant: "destructive" });
      return;
    }
    void analyzeFile(file, file.name, file.size);
  };

  const onPreset = async (p: (typeof PRESETS)[number]) => {
    try {
      setStage("decoding");
      setProgress(15);
      const resp = await fetch(p.file);
      if (!resp.ok) throw new Error("预置样本加载失败");
      const blob = await resp.blob();
      await analyzeFile(blob, p.name, blob.size);
    } catch (err) {
      setStage("error");
      toast({ title: "预置样本加载失败", description: String(err), variant: "destructive" });
    }
  };

  const busy = ["decoding", "hashing", "uploading", "analyzing"].includes(stage);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileAudio className="h-4 w-4 text-emerald-400" aria-hidden /> 文件检测
        </CardTitle>
        <CardDescription>上传可疑通话录音，服务端引擎逐窗鉴伪并固定证据</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 拖放区 */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onPick(e.dataTransfer.files);
          }}
          disabled={busy}
          className={cn(
            "grid-bg flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
            dragOver ? "border-emerald-500 bg-emerald-950/30" : "border-border hover:border-emerald-700 hover:bg-emerald-950/10",
            busy && "pointer-events-none opacity-60"
          )}
        >
          <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden />
          <div className="text-sm font-medium">拖入音频文件，或点击选择</div>
          <div className="text-xs text-muted-foreground">
            支持 wav / mp3 / m4a / ogg / flac / opus，2 秒 – 5 分钟
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.opus"
            className="sr-only"
            onChange={(e) => onPick(e.target.files)}
          />
        </button>

        {/* 处理进度 */}
        {stage !== "idle" && (
          <div className="space-y-1.5 rounded-lg border p-3">
            <div className="flex items-center justify-between text-xs">
              <span className={cn("flex items-center gap-1.5", stage === "error" ? "text-red-400" : "text-foreground")}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {stage === "done" && <FileCheck2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden />}
                {STAGE_TEXT[stage]}
              </span>
              <span className="font-mono-data text-muted-foreground">
                {fileName && `${fileName} · ${formatDuration(duration || 0)}`}
              </span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        {/* 预览播放 */}
        {previewUrl && (
          <audio controls src={previewUrl} className="w-full" preload="metadata">
            <track kind="captions" />
          </audio>
        )}

        {/* 预置演示样本 */}
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden /> 预置演示样本（一键检测，无需自备文件）
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {PRESETS.map((p) => (
              <Button
                key={p.file}
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void onPreset(p)}
                className="justify-start text-left text-xs"
              >
                {p.name}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
