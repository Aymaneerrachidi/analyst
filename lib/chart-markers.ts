import type { AnalystTrade } from "@/lib/types";
export function executionPrice(trade: AnalystTrade): number | null {
  if (trade.price != null && Number.isFinite(trade.price) && trade.price > 0) return trade.price;
  if (trade.amountUsd != null && trade.amountUsd > 0 && Number.isFinite(trade.amountUsd) && trade.tokenAmount != null && trade.tokenAmount > 0 && Number.isFinite(trade.tokenAmount)) return trade.amountUsd / trade.tokenAmount;
  return null;
}
/** Group neighboring trades by side, retaining the actual last trade's coordinates. */
export function groupMarkers(trades: AnalystTrade[], start: number, end: number, bins = 24) {
  const groups = new Map<string, AnalystTrade[]>();
  for (const trade of [...trades].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
    const t = Date.parse(trade.timestamp);
    if (!Number.isFinite(t) || t < start || t > end) continue;
    const bucket = Math.min(bins - 1, Math.floor((t - start) / Math.max(1, end - start) * bins));
    const key = `${bucket}:${trade.side}`;
    groups.set(key, [...(groups.get(key) ?? []), trade]);
  }
  return [...groups].map(([id, trades]) => ({ id, trades, trade: trades.at(-1)!, t: Date.parse(trades.at(-1)!.timestamp) }));
}
