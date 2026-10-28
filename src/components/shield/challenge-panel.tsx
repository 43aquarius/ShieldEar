"use client";

/**
 * 声盾 — 现场合成挑战面板
 * 服务端 TTS 现场合成诈骗话术语音 → 声盾引擎现场检测 → 存证闭环
 * 演示叙事：评委亲眼见证 AI 语音被生成，随后被声盾实时识破
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Zap, Loader2, ShieldAlert, AudioLines, History } from "lucide-react";
import { b64ToBlobUrl, formatDuration } from "@/lib/client/audio-client";
import type { AnalysisResult } from "@/lib/engine/types";
import { useShield } from "@/lib/store";

const VOICES: { value: string; label: string }[] = [
  { value: "tongtong", label: "桐桐 · 温暖亲切" },
  { value: "chuichui", label: "吹吹 · 活泼可爱" },
  { value: "xiaochen", label: "小陈 · 沉稳专业" },
  { value: "jam", label: "Jam · 英音绅士" },
  { value: "kazi", label: "卡兹 · 清晰标准" },
  { value: "douji", label: "豆几 · 自然流畅" },
  { value: "luodo", label: "罗多 · 富有感染力" },
];

const PRESET_SCRIPTS = [
  {
    title: "冒充亲属求助（高频诈骗话术）",
    text: "妈，我是小明啊，我手机摔坏了，这是我同学的号码。我在外地出了点事，急需八千块钱周转，你先别问我爸，把钱转到我发你的这个账户上，事后我详细跟你解释。",
  },
  {
    title: "冒充领导指令",
    text: "小王，我是张总。我现在在开一个重要会议，不方便接电话。有个紧急的付款事项需要你马上处理，把五十万转到这个账户，手续回头再补，现在马上办。",
  },
  {
    title: "正常工作通知（对照组）",
    text: "今天下午三点在会议室开项目评审会，请准备好上周的测试报告和数据材料，准时参加，不要迟到。会后我们再讨论下一阶段的排期。",
  },
];

export function ChallengePanel() {
  const { toast } = useToast();
  const setResult = useShield((s) => s.setResult);
  const [text, setText] = useState(PRESET_SCRIPTS[0].text);
  const [voice, setVoice] = useState("tongtong");
  const [busy, setBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [synthInfo, setSynthInfo] = useState<{
    voice: string;
    durationSec: number;
    mode: "live" | "fallback";
  } | null>(null);

  const run = async () => {
    if (!text.trim()) {
      toast({ title: "请输入合成文本", variant: "destructive" });
      return;
    }
    setBusy(true);
    setAudioUrl(null);
    setSynthInfo(null);
    try {
      const resp = await fetch("/api/tts-challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), voice }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "合成失败");
      const url = b64ToBlobUrl(data.audio.evidenceB64);
      setAudioUrl(url);
      setSynthInfo({
        voice: data.tts.voice,
        durationSec: data.audio.durationSec,
        mode: (data.mode as "live" | "fallback") ?? "live",
      });
      setResult(
        data.analysis as AnalysisResult,
        {
          caseNo: data.caseNo,
          createdAt: data.createdAt,
          audioHash: data.audioHash,
          sourceHash: data.sourceHash,
          sourceType: "TTS",
          sourceLabel:
            (data.mode as string) === "fallback"
              ? `合成挑战(预置样本回放) · ${data.tts.voice}`
              : `现场合成挑战 · ${data.tts.voice}`,
          fileName: `tts_${data.tts.voice}.wav`,
          durationSec: data.audio.durationSec,
          engineVersion: data.analysis.engine.version,
          rtf: data.analysis.stats.rtf,
        },
        url
      );
      const risk = data.analysis.overall.risk as string;
      const isFallback = (data.mode as string) === "fallback";
      if (isFallback) {
        toast({
          title: "TTS 通道暂不可用 — 已回放预置合成样本",
          description: `${data.analysis.overall.verdict} · 同一 TTS 引擎预生成的诈骗话术样本，检测判决同样实时完成`,
        });
      } else if (risk === "HIGH" || risk === "CRITICAL") {
        toast({
          title: "现场合成的语音已被声盾识破",
          description: `${data.analysis.overall.verdict} · 合成置信度 ${(data.analysis.overall.syntheticRatio * 100).toFixed(1)}%`,
        });
      } else {
        toast({
          title: "检测完成",
          description: `${data.analysis.overall.verdict} · 该音色在本引擎下的检出置信度偏低，可换音色对比`,
        });
      }
    } catch (err) {
      toast({
        title: "合成挑战失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4 text-amber-400" aria-hidden /> 现场合成挑战
        </CardTitle>
        <CardDescription>
          平台现场用 AI 合成一段语音，再当场交给声盾检测 — 完整演示「生成 → 检出 → 存证」闭环
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 预设话术 */}
        <div className="flex flex-wrap gap-2">
          {PRESET_SCRIPTS.map((p) => (
            <Button
              key={p.title}
              variant="outline"
              size="sm"
              onClick={() => setText(p.text)}
              className="text-xs"
            >
              {p.title}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="challenge-text" className="text-xs text-muted-foreground">
            合成文本（≤1024 字，模板仅用于鉴伪能力演示）
          </Label>
          <Textarea
            id="challenge-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={1024}
            className="resize-none"
            placeholder="输入要合成的文本…"
          />
          <div className="text-right font-mono-data text-[11px] text-muted-foreground">
            {text.length}/1024
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">合成音色</Label>
            <Select value={voice} onValueChange={setVoice}>
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOICES.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void run()} disabled={busy} className="gap-2">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 合成并检测中…
              </>
            ) : (
              <>
                <AudioLines className="h-4 w-4" aria-hidden /> 现场合成并检测
              </>
            )}
          </Button>
        </div>

        {audioUrl && synthInfo && (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {synthInfo.mode === "fallback" ? (
                <>
                  <History className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                  <span className="rounded bg-amber-400/15 px-1.5 py-0.5 font-medium text-amber-500">
                    预置样本回放
                  </span>
                  TTS 通道暂不可用，以下为同一 TTS 引擎预先生成的「{synthInfo.voice}」音色诈骗话术样本 —
                  下方检测结果即声盾对该音频的实时判决（存证中已如实标注回放模式）
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                  平台于现场使用 TTS 音色「{synthInfo.voice}」合成了 {formatDuration(synthInfo.durationSec)} 语音 —
                  下方检测结果即声盾对该段音频的实时判决
                </>
              )}
            </div>
            <audio controls src={audioUrl} className="w-full">
              <track kind="captions" />
            </audio>
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          说明：合成与检测均在服务端完成，原始合成音频与其 16kHz 分析副本分别计算 SHA-256
          并写入证据链（「这份音频确实由平台现场生成」与「检测对象即该音频」双向锚定）。
          若 TTS 通道暂时不可用（限流/风控），将自动回放同引擎预置合成样本并如实标注，演示闭环不中断；
          亦可改用「文件检测」中的预置合成样本。
        </p>
      </CardContent>
    </Card>
  );
}
