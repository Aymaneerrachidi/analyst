import type { AnalystTrade, TokenCandle } from "./types";
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
