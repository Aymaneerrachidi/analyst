import { clamp } from "@/lib/utils";
import type { ScoreBreakdown } from "@/lib/types";

/**
 * ANALYST SCORE (0–100) — an explainable, deterministic blend of tracked-trader behaviour.
 * Components are stored separately so the UI can show exactly what drove the number.
 * It describes current smart-money positioning; it does not predict price.
 */
export const SCORE_WEIGHTS = {
  quality: 0.3,
  accumulation: 0.25,
  breadth: 0.2,
  conviction: 0.15,
  momentum: 0.1,
} as const;

export interface ScoreInput {
  buyers: number;
  sellers: number;
  buys: number;
  sells: number;
  buyUsd: number;
  sellUsd: number;
  netFlowUsd: number;
  /** Buy-USD-weighted mean percentile (0..1) of the buying traders by all-time realized PnL. */
  buyerQuality: number | null;
  /** Mean of (buy size / that trader's average trade size) across buys. */
  convictionRatio: number | null;
  /** Share of buyers who bought more than once in the window (0..1). */
  repeatBuyerShare: number;
  /** Share of window USD activity that happened in the most recent half (0..1). */
  recentShare: number | null;
  /** Largest |net flow| among tokens in the same window; used to normalize accumulation. */
  netFlowScale: number;
}

function confidence(n: number, full: number): number {
  return clamp(n / full, 0, 1);
}

/** Pulls a raw 0..100 value toward 50 when sample size is small. */
function damp(value: number, n: number, full: number): number {
  const c = confidence(n, full);
  return 50 + (value - 50) * c;
}

export function computeScore(input: ScoreInput): ScoreBreakdown {
  const participants = input.buyers + input.sellers;

  const quality = damp(input.buyerQuality === null ? 50 : input.buyerQuality * 100, input.buyers, 3);

  const scale = Math.max(input.netFlowScale, 1);
  const flowTerm = 50 + 50 * Math.tanh((3 * input.netFlowUsd) / scale);
  const gross = input.buyUsd + input.sellUsd;
  const dominanceTerm = gross > 0 ? (100 * input.buyUsd) / gross : 50;
  const accumulation = damp(0.55 * flowTerm + 0.45 * dominanceTerm, input.buys + input.sells, 4);

  const breadthRaw = participants > 0 ? (100 * input.buyers) / participants : 50;
  const breadth = damp(breadthRaw, participants, 5);

  const ratio = input.convictionRatio === null ? 1 : Math.max(input.convictionRatio, 0.05);
  const sizeTerm = clamp(50 + 25 * Math.log2(ratio), 0, 100);
  const repeatTerm = 100 * input.repeatBuyerShare;
  const conviction = damp(0.65 * sizeTerm + 0.35 * repeatTerm, input.buys, 3);

  const momentumRaw = input.recentShare === null ? 50 : clamp(50 + (input.recentShare - 0.5) * 120, 0, 100);
  const momentum = damp(momentumRaw, input.buys + input.sells, 3);

  const score =
    SCORE_WEIGHTS.quality * quality +
    SCORE_WEIGHTS.accumulation * accumulation +
    SCORE_WEIGHTS.breadth * breadth +
    SCORE_WEIGHTS.conviction * conviction +
    SCORE_WEIGHTS.momentum * momentum;

  return {
    score: Math.round(clamp(score, 0, 100)),
    quality: Math.round(clamp(quality, 0, 100)),
    accumulation: Math.round(clamp(accumulation, 0, 100)),
    breadth: Math.round(clamp(breadth, 0, 100)),
    conviction: Math.round(clamp(conviction, 0, 100)),
    momentum: Math.round(clamp(momentum, 0, 100)),
  };
}

export function scoreLabel(score: number): string {
  if (score >= 80) return "Very high activity";
  if (score >= 65) return "High activity";
  if (score >= 45) return "Moderate activity";
  if (score >= 30) return "Low activity";
  return "Very low activity";
}

export function scoreTone(score: number): "positive" | "neutral" | "negative" {
  if (score >= 65) return "positive";
  if (score >= 45) return "neutral";
  return "negative";
}
