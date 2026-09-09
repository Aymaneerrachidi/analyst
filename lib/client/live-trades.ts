import { z } from "zod";
import { cleanSymbol } from "@/lib/presentation";
import type { AnalystTrade, AnalystTrader } from "@/lib/types";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(v => v.toLowerCase());
const number = z.union([z.number(), z.string()]).nullish().transform(v => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null;
});
const eventSchema = z.object({
  tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/), wallet_address: address,
  wallet_name: z.string().nullish(), action: z.enum(["buy", "sell", "BUY", "SELL"]),
  token_address: address, token_symbol: z.string().nullish(), token_name: z.string().nullish(),
  usd_value: number, token_amount: number, timestamp: z.string().refine(v => Number.isFinite(Date.parse(v))),
});

export function parseLiveTrade(value: unknown): AnalystTrade | null {
  const parsed = eventSchema.safeParse(value);
  if (!parsed.success) return null;
  const r = parsed.data;
  const side = r.action.toUpperCase() as "BUY" | "SELL";
  const symbol = cleanSymbol(r.token_symbol || r.token_address.slice(0, 8));
  return {
    id: `stream:${r.tx_hash.toLowerCase()}:${r.wallet_address}:${r.token_address}:${side}`,
    seq: 0, traderId: r.wallet_address,
    trader: { id: r.wallet_address, wallet: r.wallet_address, name: r.wallet_name || r.wallet_address.slice(0, 8), handle: r.wallet_name || r.wallet_address },
    token: { address: r.token_address, symbol, name: r.token_name || symbol },
    side, amountUsd: r.usd_value, tokenAmount: r.token_amount,
    price: r.token_amount && r.usd_value !== null ? r.usd_value / r.token_amount : null,
    realizedPnl: null, timestamp: new Date(r.timestamp).toISOString(), txHash: r.tx_hash.toLowerCase(),
  };
}

export function tradeIdentity(t: AnalystTrade): string {
  const base = transactionIdentity(t);
  return t.logIndex == null ? base : `${base}:log:${t.logIndex}`;
}
function transactionIdentity(t: AnalystTrade): string {
  return t.txHash ? `${t.txHash.toLowerCase()}:${t.traderId.toLowerCase()}:${t.token.address.toLowerCase()}:${t.side}` : t.id;
}

/** Stream IDs and database IDs differ; reconcile by chain identity without moving the database cursor. */
export function mergeLiveTrades(current: AnalystTrade[], incoming: AnalystTrade[], limit: number): AnalystTrade[] {
  // Canonical receipt fills replace an upstream transaction aggregate; preserve each log.
  const canonical = new Set([...current, ...incoming].filter(t => t.logIndex != null).map(transactionIdentity));
  const keep = (t: AnalystTrade) => t.logIndex != null || !canonical.has(transactionIdentity(t));
  const map = new Map(current.filter(keep).map(t => [tradeIdentity(t), t]));
  const traders = new Map(current.map(t => [t.traderId, t.trader]));
  const tokens = new Map(current.map(t => [t.token.address, t.token]));
  for (const t of incoming.filter(keep)) {
    const key = tradeIdentity(t), previous = map.get(key);
    if (previous) {
      const stored = t.seq > 0 ? t : previous;
      const other = stored === t ? previous : t;
      map.set(key, { ...other, ...stored, price: stored.price ?? other.price, realizedPnl: stored.realizedPnl ?? other.realizedPnl,
        trader: { ...other.trader, ...stored.trader, avatar: stored.trader.avatar || other.trader.avatar },
        token: { ...other.token, ...stored.token, image: stored.token.image || other.token.image } });
    } else map.set(key, { ...t, trader: traders.get(t.traderId) ?? t.trader, token: tokens.get(t.token.address) ?? t.token });
  }
  return [...map.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.seq - a.seq).slice(0, limit);
}

export function matchesTrade(t: AnalystTrade, p: Record<string, string | undefined>, ranks: Map<string, AnalystTrader>): boolean {
  if (p.filter === "buys" && t.side !== "BUY" || p.filter === "sells" && t.side !== "SELL") return false;
  if ((p.filter === "large" && (t.amountUsd ?? 0) < 5000) || (p.minUsd && (t.amountUsd ?? 0) < Number(p.minUsd))) return false;
  if (p.filter === "top" && !(ranks.get(t.traderId)?.rank && ranks.get(t.traderId)!.rank! <= 10)) return false;
  if (p.trader && t.traderId !== p.trader.toLowerCase() || p.token && t.token.address !== p.token.toLowerCase()) return false;
  const q = p.q?.replace(/^\$/, "").toLowerCase();
  return !q || [t.token.symbol, t.token.name, t.token.address].some(v => v.toLowerCase().includes(q));
}
