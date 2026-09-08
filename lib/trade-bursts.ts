import type { AnalystTrade } from "./types";
export interface TradeBurst { id: string; trades: AnalystTrade[]; knownUsd: number; knownValues: number }
/** A burst spans at most 60 seconds; opposite sides and different wallets never merge. */
export function groupTradeBursts(trades: AnalystTrade[], spanMs = 60_000): TradeBurst[] {
  const groups: TradeBurst[] = [];
  const latest = new Map<string, TradeBurst>();
  for (const trade of [...trades].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))) {
    const key = `${trade.traderId.toLowerCase()}:${trade.token.address.toLowerCase()}:${trade.side}`;
    let group = latest.get(key);
    if (!group || Date.parse(group.trades[0].timestamp) - Date.parse(trade.timestamp) > spanMs) {
      group = { id: trade.id, trades: [], knownUsd: 0, knownValues: 0 }; groups.push(group); latest.set(key, group);
    }
    group.trades.push(trade);
    if (trade.amountUsd != null && Number.isFinite(trade.amountUsd)) { group.knownUsd += trade.amountUsd; group.knownValues++; }
  }
  return groups;
}
