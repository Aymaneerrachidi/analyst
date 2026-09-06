"use client";

import { Info } from "lucide-react";
import type { ScoreBreakdown } from "@/lib/types";
import { SCORE_WEIGHTS, scoreLabel, scoreTone } from "@/lib/services/score";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const toneClass = {
  positive: "text-neon",
  neutral: "text-primary",
  negative: "text-negative",
} as const;

const ringClass = {
  positive: "border-neon/40",
  neutral: "border-border-hover",
  negative: "border-negative/40",
} as const;

const ROWS: { key: keyof Omit<ScoreBreakdown, "score">; label: string; weight: number }[] = [
  { key: "quality", label: "Top Trader Quality", weight: SCORE_WEIGHTS.quality },
  { key: "accumulation", label: "Accumulation", weight: SCORE_WEIGHTS.accumulation },
  { key: "breadth", label: "Breadth", weight: SCORE_WEIGHTS.breadth },
  { key: "conviction", label: "Conviction", weight: SCORE_WEIGHTS.conviction },
  { key: "momentum", label: "Momentum", weight: SCORE_WEIGHTS.momentum },
];

export function ScoreBreakdownPanel({ score, window }: { score: ScoreBreakdown; window?: string }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <span className="label-caps">Analyst Score {window ? `· ${window}` : ""}</span>
        <span className={cn("text-xl font-semibold tnum", toneClass[scoreTone(score.score)])}>{score.score}</span>
      </div>
      <ul className="space-y-2">
        {ROWS.map((r) => (
          <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-3 text-[13px]">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-secondary">{r.label}</span>
                <span className="text-muted tnum">{Math.round(r.weight * 100)}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full bg-neon/80" style={{ width: `${score[r.key]}%` }} />
              </div>
            </div>
            <span className="w-7 text-right font-medium tnum">{score[r.key]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Derived from tracked-trader activity in the window: who is buying, how much, how broadly, and how recently. Describes positioning. It does not
        predict price and is not financial advice.
      </p>
    </div>
  );
}

/** Compact score pill for tables and cards, with an explanation popover. */
export function AnalystScoreBadge({ score, window, size = "sm" }: { score: ScoreBreakdown; window?: string; size?: "sm" | "md" }) {
  const t = scoreTone(score.score);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center rounded-md border bg-surface font-semibold tnum transition-colors hover:bg-hover",
            size === "sm" ? "h-7 min-w-9 px-2 text-[13px]" : "h-9 min-w-12 px-3 text-base",
            ringClass[t],
            toneClass[t],
          )}
          aria-label={`Analyst Score ${score.score}, ${scoreLabel(score.score)}. Show breakdown`}
        >
          {score.score}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <ScoreBreakdownPanel score={score} window={window} />
      </PopoverContent>
    </Popover>
  );
}

/** Hero-size score for the token page. */
export function AnalystScoreCard({ score, window }: { score: ScoreBreakdown; window: string }) {
  const t = scoreTone(score.score);
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <p className="label-caps">Analyst Score</p>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="rounded-md p-1 text-muted transition-colors hover:text-primary" aria-label="How the Analyst Score works">
              <Info className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <ScoreBreakdownPanel score={score} window={window} />
          </PopoverContent>
        </Popover>
      </div>
      <div className="mt-2 flex items-end gap-3">
        <span className={cn("text-5xl font-semibold leading-none tracking-tight tnum", toneClass[t])}>{score.score}</span>
        <span className="pb-1 text-sm font-medium text-secondary">{scoreLabel(score.score)}</span>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-1.5" aria-hidden>
        {ROWS.map((r) => (
          <div key={r.key} className="h-1 overflow-hidden rounded-full bg-white/[0.06]" title={`${r.label} ${score[r.key]}`}>
            <div className="h-full bg-neon/70" style={{ width: `${score[r.key]}%` }} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">0–100 · {window} window · Not financial advice</p>
    </div>
  );
}
