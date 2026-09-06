import { z } from "zod";
import type { AnalystTrade, AnalystTraderRef } from "@/lib/types";
import { tradeIdentity } from "./live-trades";

const address = z.string().regex(/^0x[\da-f]{40}$/i).transform((s) => s.toLowerCase());
const follow = z.object({ id: address, wallet: address, name: z.string().max(200), handle: z.string().max(200), avatar: z.string().max(2048).nullish() });
export const alertRuleSchema = z.object({
  id: z.string().max(80), name: z.string().trim().min(1).max(80),
  scope: z.enum(["following", "wallet", "all"]), wallet: z.union([address, z.literal("")]),
  side: z.enum(["all", "BUY", "SELL"]), minUsd: z.number().finite().min(0).max(1e12),
  token: z.string().trim().max(64), enabled: z.boolean(), armedAt: z.number().finite().nonnegative(),
}).refine((r) => r.scope !== "wallet" || r.wallet.length > 0, "Choose a wallet address");
export type AlertRule = z.infer<typeof alertRuleSchema>;
const alertSchema = z.object({ id: z.string(), trader: follow, symbol: z.string(), token: address,
  side: z.enum(["BUY", "SELL"]), amountUsd: z.number().nullable(), timestamp: z.string(),
  txHash: z.string().nullable(), ruleNames: z.array(z.string()), read: z.boolean() });
export type TradeAlert = z.infer<typeof alertSchema>;
const trackingSchema = z.object({ following: z.array(follow).max(100), rules: z.array(alertRuleSchema).max(30),
  inbox: z.array(alertSchema).max(100), seen: z.array(z.string()).max(2000), desktop: z.boolean() });
export type TrackingState = z.infer<typeof trackingSchema>;
export const emptyTracking = (): TrackingState => ({ following: [], rules: [], inbox: [], seen: [], desktop: false });
export function parseTracking(raw: string): TrackingState {
  try { return trackingSchema.parse(JSON.parse(raw)); } catch { return emptyTracking(); }
}
export function matchesAlert(trade: AnalystTrade, rule: AlertRule, following: AnalystTraderRef[], now: number): boolean {
  const timestamp = Date.parse(trade.timestamp);
  if (!rule.enabled || !Number.isFinite(timestamp) || timestamp < rule.armedAt || timestamp < now - 10 * 60_000 || timestamp > now + 60_000) return false;
  if (rule.scope === "following" && !following.some((t) => t.id.toLowerCase() === trade.traderId.toLowerCase())) return false;
  if (rule.scope === "wallet" && rule.wallet.toLowerCase() !== trade.traderId.toLowerCase()) return false;
  if (rule.side !== "all" && trade.side !== rule.side) return false;
  if (rule.minUsd > 0 && (trade.amountUsd == null || !Number.isFinite(trade.amountUsd) || trade.amountUsd < rule.minUsd)) return false;
  const token = rule.token.toLowerCase().replace(/^\$/, "");
  return !token || trade.token.address.toLowerCase() === token || trade.token.symbol.toLowerCase() === token;
}
export function evaluateAlerts(trades: AnalystTrade[], state: TrackingState, now: number): TradeAlert[] {
  const seen = new Set(state.seen);
  const alerts: TradeAlert[] = [];
  for (const t of [...trades].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
    const id = tradeIdentity(t);
    if (seen.has(id)) continue;
    const rules = state.rules.filter((r) => matchesAlert(t, r, state.following, now));
    if (!rules.length) continue;
    seen.add(id);
    alerts.push({ id, trader: state.following.find((f) => f.id === t.traderId) ?? t.trader,
      symbol: t.token.symbol, token: t.token.address, side: t.side, amountUsd: t.amountUsd ?? null,
      timestamp: t.timestamp, txHash: t.txHash ?? null, ruleNames: rules.map((r) => r.name), read: false });
  }
  return alerts;
}
