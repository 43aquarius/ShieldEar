"use client";

/**
 * 声盾 — 应用外壳（单页应用，答辩演示零跳转）
 * 工作台（实时鉴听 / 文件检测 / 现场合成挑战）· 案例库 · 技术方案
 */

import { Shield as ShieldAppIcon, PhoneCall, FileAudio, Zap, BookOpen, Database, Cog } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useShield } from "@/lib/store";
import { ENGINE_VERSION } from "@/lib/engine/types";
import { LivePanel } from "./live-panel";
import { FilePanel } from "./file-panel";
import { ChallengePanel } from "./challenge-panel";
import { ResultPanel } from "./result-panel";
import { CasesView } from "./cases-view";
import { TechView } from "./tech-view";
import { ReportPrint } from "./report-print";
import { cn } from "@/lib/utils";

const NAV = [
  { key: "workbench", label: "检测工作台", icon: PhoneCall },
  { key: "cases", label: "案例库", icon: Database },
  { key: "tech", label: "技术方案", icon: Cog },
] as const;

export function ShieldApp() {
  const { view, setView, workMode, setWorkMode, result } = useShield();

  return (
    <>
      <div id="app-shell-root" className="flex min-h-screen flex-col">
        {/* 顶部导航 */}
        <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 border border-primary/30">
                <ShieldAppIcon className="h-4 w-4 text-primary" aria-hidden />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-bold tracking-wide">
                  声盾 <span className="font-mono-data text-[10px] font-normal text-muted-foreground">ShieldEar</span>
                </div>
                <div className="text-[10px] text-muted-foreground">AI 语音诈骗实时鉴伪反诈平台</div>
              </div>
            </div>

            <nav className="ml-auto flex items-center gap-1" aria-label="主导航">
              {NAV.map((n) => (
                <Button
                  key={n.key}
                  size="sm"
                  variant={view === n.key ? "secondary" : "ghost"}
                  className={cn("gap-1.5 text-xs", view === n.key && "font-semibold")}
                  onClick={() => setView(n.key)}
                >
                  <n.icon className="h-3.5 w-3.5" aria-hidden />
                  <span className="hidden sm:inline">{n.label}</span>
                </Button>
              ))}
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {view === "workbench" && (
            <div className="space-y-6">
              {/* Hero */}
              <section className="relative overflow-hidden rounded-xl border bg-gradient-to-b from-primary/10 to-transparent">
                <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
                <div className="relative flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
                  <div className="max-w-xl">
                    <h1 className="text-2xl font-bold leading-tight">
                      这通电话，是<span className="text-primary">真人</span>还是
                      <span className="text-primary"> AI</span>？
                    </h1>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      接到自称亲友的紧急求助来电时，开启声盾 — 滑动窗口流式检测通话语音，逐窗给出合成置信度，
                      检出即告警；通话结束自动固定 SHA-256 证据并生成可导出的核验报告。
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="gap-1 text-[11px]">
                        <Zap className="h-3 w-3 text-amber-400" aria-hidden /> 2s 窗 / 50% 重叠流式检测
                      </Badge>
                      <Badge variant="outline" className="gap-1 text-[11px]">
                        <FileAudio className="h-3 w-3 text-emerald-400" aria-hidden /> 8 维可解释特征
                      </Badge>
                      <Badge variant="outline" className="gap-1 text-[11px] font-mono-data">
                        引擎 {ENGINE_VERSION} · RTF &lt; 0.01
                      </Badge>
                      <Badge variant="outline" className="gap-1 text-[11px]">
                        <BookOpen className="h-3 w-3" aria-hidden /> 客户端初判 + 服务端复核
                      </Badge>
                    </div>
                  </div>
                  {/* 演示动线 */}
                  <div className="w-full max-w-[260px] rounded-lg border bg-card/80 p-3 text-xs leading-5">
                    <div className="mb-1 font-semibold text-foreground">答辩演示动线（3 步）</div>
                    <ol className="space-y-1 text-muted-foreground">
                      <li>1. 「现场合成挑战」生成诈骗话术语音</li>
                      <li>2. 外放同时开启「实时鉴听」→ 实时告警</li>
                      <li>3. 结束鉴听 → 存证 → 导出核验报告 PDF</li>
                    </ol>
                  </div>
                </div>
              </section>

              {/* 模式切换 */}
              <Tabs value={workMode} onValueChange={(v) => setWorkMode(v as typeof workMode)}>
                <TabsList className="grid w-full max-w-md grid-cols-3">
                  <TabsTrigger value="live" className="gap-1.5 text-xs sm:text-sm">
                    <PhoneCall className="h-3.5 w-3.5" aria-hidden /> 实时鉴听
                  </TabsTrigger>
                  <TabsTrigger value="file" className="gap-1.5 text-xs sm:text-sm">
                    <FileAudio className="h-3.5 w-3.5" aria-hidden /> 文件检测
                  </TabsTrigger>
                  <TabsTrigger value="challenge" className="gap-1.5 text-xs sm:text-sm">
                    <Zap className="h-3.5 w-3.5" aria-hidden /> 合成挑战
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="live" className="mt-4">
                  <LivePanel />
                </TabsContent>
                <TabsContent value="file" className="mt-4">
                  <FilePanel />
                </TabsContent>
                <TabsContent value="challenge" className="mt-4">
                  <ChallengePanel />
                </TabsContent>
              </Tabs>

              {/* 检测结果 */}
              {result && (
                <section aria-label="检测结果">
                  <ResultPanel />
                </section>
              )}
            </div>
          )}

          {view === "cases" && <CasesView />}
          {view === "tech" && <TechView />}
        </main>

        {/* 页脚 */}
        <footer className="mt-auto border-t bg-background/90">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-muted-foreground">
            <span>
              声盾 ShieldEar · 全国大学生信息安全竞赛参赛作品演示 · 辅助验真工具，结论不构成执法意见
            </span>
            <span className="font-mono-data">
              遇电信诈骗请拨 96110 · 引擎 {ENGINE_VERSION}
            </span>
          </div>
        </footer>
      </div>

      {/* 打印视图（屏幕隐藏，打印时独占） */}
      <ReportPrint />
    </>
  );
}
