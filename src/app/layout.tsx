import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "声盾 ShieldEar — AI 语音诈骗实时鉴伪反诈平台",
  description:
    "声盾：面向 AI 语音诈骗的实时鉴伪反诈平台。滑动窗口流式检测、逐窗置信度、可解释特征剖面、SHA-256 存证与核验报告，构建反诈验真业务闭环。",
  keywords: [
    "AI语音鉴伪",
    "深度伪造检测",
    "反诈",
    "声盾",
    "ShieldEar",
    "音频取证",
    "合成语音检测",
  ],
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0f0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground min-h-screen">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
