import type { AnalystTrade, TokenCandle, TokenChartData } from "./types";
import { executionPrice } from "./chart-markers";

/** Append only observed executions; market candles must be refreshed from their own source. */
export function liveExecutionSeries(candles: TokenCandle[], trades: AnalystTrade[], start: number): TokenCandle[] {
  const last = candles.at(-1)?.t ?? start;
  const incoming = trades.flatMap(t => {
    const at = Date.parse(t.timestamp), price = executionPrice(t);
    return price != null && Number.isFinite(price) && at > last && at >= start
      ? [{ t: at, close: price, volume: t.amountUsd ?? 0 }] : [];
  });
  return [...candles, ...incoming].sort((a, b) => a.t - b.t).slice(-1000);
}

export function chartTimeDomain(candles: TokenCandle[]): [number, number] | ["dataMin", "dataMax"] {
  if (candles.length === 1) return [candles[0].t - 60_000, candles[0].t + 60_000];
  return ["dataMin", "dataMax"];
}

export function preserveChartHistory(current: TokenChartData, previous: TokenChartData | null, now: number): TokenChartData {
  if (current.candles.length || !previous || previous.window !== current.window) return current;
  const from = now - { "1h": 3_600_000, "6h": 21_600_000, "24h": 86_400_000, "7d": 604_800_000 }[current.window];
  const candles = previous.candles.filter(c => c.t >= from && c.t <= now);
  if (!candles.length) return current;
  return { ...previous, candles, activity: current.activity, markers: current.markers,
    error: `Price source unavailable. Showing previously retrieved history through ${new Date(candles.at(-1)!.t).toISOString()}.` };
}
