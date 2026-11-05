"use client";

/**
 * 声盾 — 哈希展示（截断 + 一键复制）
 */
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function HashText({
  hash,
  label,
  className,
  full = false,
}: {
  hash: string;
  label?: string;
  className?: string;
  full?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const display = full ? hash : `${hash.slice(0, 10)}…${hash.slice(-8)}`;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(hash).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      className={cn(
        "group inline-flex max-w-full items-center gap-1.5 font-mono-data text-xs text-muted-foreground hover:text-foreground transition-colors",
        className
      )}
      title={hash}
    >
      {label && <span className="shrink-0 text-foreground/70">{label}</span>}
      <span className="truncate tracking-tight">{display}</span>
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden />
      ) : (
        <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" aria-hidden />
      )}
      <span className="sr-only">复制完整哈希 {hash}</span>
    </button>
  );
}
