import type { ReactNode } from "react";
import { formatPct, formatUsd, formatUsdSigned } from "@/lib/format";
import { cn } from "@/lib/utils";

export function tone(n: number | null | undefined): "positive" | "negative" | "neutral" {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return "neutral";
  return n > 0 ? "positive" : "negative";
}

export const toneClass = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-secondary",
} as const;

/** Signed USD with semantic colour. */
export function MoneyDelta({ value, className, muted }: { value: number | null | undefined; className?: string; muted?: boolean }) {
  const t = tone(value);
  return <span className={cn("tnum", muted && t === "neutral" ? "text-muted" : toneClass[t], className)}>{formatUsdSigned(value)}</span>;
}

/** Signed percentage with semantic colour. */
export function PctDelta({ value, className, digits }: { value: number | null | undefined; className?: string; digits?: number }) {
  const t = tone(value);
  return <span className={cn("tnum", toneClass[t], className)}>{formatPct(value, { digits })}</span>;
}

export function Money({ value, className }: { value: number | null | undefined; className?: string }) {
  return <span className={cn("tnum", className)}>{formatUsd(value)}</span>;
}

export function MetricCard({
  label,
  value,
  hint,
  children,
  className,
}: {
  label: string;
  value?: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("card px-4 py-3.5", className)}>
      <p className="label-caps">{label}</p>
      {value !== undefined && <p className="mt-1.5 text-xl font-semibold tracking-tight tnum">{value}</p>}
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function SideBadge({ side, className }: { side: "BUY" | "SELL"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2 text-[11px] font-semibold tracking-wide",
        side === "BUY" ? "bg-neon/10 text-neon" : "bg-negative/10 text-negative",
        className,
      )}
    >
      {side}
    </span>
  );
}
