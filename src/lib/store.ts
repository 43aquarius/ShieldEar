/**
 * 声盾 — 全局状态（zustand）
 */
import { create } from "zustand";
import type { AnalysisResult } from "@/lib/engine/types";

export type View = "workbench" | "cases" | "tech";
export type WorkMode = "live" | "file" | "challenge";

/** 案例元信息（存证链） */
export interface ResultMeta {
  caseNo: string;
  createdAt: string;
  audioHash: string;
  sourceHash?: string | null;
  sourceType: "LIVE" | "UPLOAD" | "TTS";
  sourceLabel: string;
  fileName?: string | null;
  durationSec: number;
  engineVersion: string;
  rtf?: number;
}

interface ShieldState {
  view: View;
  workMode: WorkMode;
  result: AnalysisResult | null;
  meta: ResultMeta | null;
  /** 结果面板中待播放的证据音频（blob URL） */
  audioUrl: string | null;
  setView: (v: View) => void;
  setWorkMode: (m: WorkMode) => void;
  setResult: (r: AnalysisResult | null, m: ResultMeta | null, audioUrl?: string | null) => void;
  clearResult: () => void;
}

export const useShield = create<ShieldState>((set) => ({
  view: "workbench",
  workMode: "live",
  result: null,
  meta: null,
  audioUrl: null,
  setView: (v) => set({ view: v }),
  setWorkMode: (m) => set({ workMode: m }),
  setResult: (r, m, audioUrl) =>
    set({ result: r, meta: m, audioUrl: audioUrl ?? null }),
  clearResult: () => set({ result: null, meta: null, audioUrl: null }),
}));
