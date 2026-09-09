export type MetricPeriod = "24h" | "7d" | "30d" | "all";
export const PERIOD_DURATION: Record<MetricPeriod, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, all: Number.POSITIVE_INFINITY };
export interface MeasuredTrade {
  id: string; token: string; timestamp: number; order: number; side: "BUY" | "SELL";
  quantity: number | null; usd: number | null; attribution?: string;
  entryMarketCap?: number | null; tokenAgeMs?: number | null;
}
const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const clamp = (v: number, min = 0, max = 100) => Math.min(max, Math.max(min, v));
export const median = (values: number[]) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** Weighted average accounting, with pre-period inventory and no post-cutoff information. */
export function calculateWalletMetrics(input: MeasuredTrade[], period: MetricPeriod, now: number) {
  const rows = input.filter(t => Number.isFinite(t.timestamp) && t.timestamp <= now).sort((a, b) => a.timestamp - b.timestamp || a.order - b.order || a.id.localeCompare(b.id));
  const start = now - PERIOD_DURATION[period];
  const inventory = new Map<string, { quantity: number | null; cost: number | null; acquired: number | null }>();
  const closes: { id: string; token: string; at: number; pnl: number; basis: number; returnPct: number | null; hold: number | null; complete: boolean }[] = [];
  const selected = rows.filter(t => t.timestamp >= start);
  let priced = 0, uncoveredSells = 0;
  for (const trade of rows) {
    const state = inventory.get(trade.token) ?? { quantity: 0, cost: 0, acquired: null };
    inventory.set(trade.token, state);
    const inPeriod = trade.timestamp >= start;
    const quantity = finite(trade.quantity) && trade.quantity > 0 ? trade.quantity : null;
    const usd = finite(trade.usd) && trade.usd >= 0 ? trade.usd : null;
    const attributed = !['payer differs from recipient', 'unverified swap attribution', 'transaction initiator'].includes(trade.attribution ?? '');
    if (inPeriod && quantity != null && usd != null && attributed) priced++;
    if (!attributed || quantity == null) { state.quantity = null; state.cost = null; state.acquired = null; if (inPeriod && trade.side === "SELL") uncoveredSells++; continue; }
    if (trade.side === "BUY") {
      if (state.quantity != null) {
        state.acquired = state.quantity === 0 ? trade.timestamp : state.acquired == null ? null : (state.acquired * state.quantity + trade.timestamp * quantity) / (state.quantity + quantity);
        state.quantity += quantity;
      }
      state.cost = state.cost != null && usd != null ? state.cost + usd : null;
      continue;
    }
    const matched = state.quantity == null ? null : Math.min(quantity, state.quantity);
    if (matched != null && matched > 0 && state.cost != null && usd != null && state.quantity != null) {
      const basis = state.cost * matched / state.quantity;
      const pnl = usd * matched / quantity - basis;
      if (inPeriod) closes.push({ id: trade.id, token: trade.token, at: trade.timestamp, pnl, basis, returnPct: basis > 0 ? pnl / basis * 100 : null, hold: state.acquired != null ? Math.max(0, trade.timestamp - state.acquired) : null, complete: matched === quantity });
      state.cost -= basis;
    } else if (inPeriod) uncoveredSells++;
    if (matched != null && matched < quantity && inPeriod) uncoveredSells++;
    if (state.quantity != null) {
      // Unknown sale proceeds do not erase known cost basis of the remaining inventory.
      if (state.cost != null && usd == null && state.quantity > 0 && matched != null) state.cost *= Math.max(0, 1 - matched / state.quantity);
      state.quantity = Math.max(0, state.quantity - quantity);
      if (state.quantity === 0) { state.cost = 0; state.acquired = null; }
    }
  }
  const complete = closes.filter(t => t.complete);
  const winners = complete.filter(t => t.pnl > 0), losers = complete.filter(t => t.pnl < 0);
  const grossProfit = winners.reduce((sum, t) => sum + t.pnl, 0), grossLoss = -losers.reduce((sum, t) => sum + t.pnl, 0);
  const realizedPnl = closes.length ? closes.reduce((sum, t) => sum + t.pnl, 0) : null;
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (const t of closes) { equity += t.pnl; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); }
  const byDay = new Map<string, number>(), tokenProfit = new Map<string, number>();
  for (const t of complete) { const day = new Date(t.at).toISOString().slice(0, 10); byDay.set(day, (byDay.get(day) ?? 0) + t.pnl); if (t.pnl > 0) tokenProfit.set(t.token, (tokenProfit.get(t.token) ?? 0) + t.pnl); }
  const activeDays = byDay.size, distinctTokens = new Set(complete.map(t => t.token)).size;
  const sampleConfidence = Math.min(1, complete.length / 50) * Math.min(1, distinctTokens / 5) * Math.min(1, activeDays / 7) * (selected.length ? priced / selected.length : 0);
  const sufficient = complete.length >= 20 && distinctTokens >= 3 && activeDays >= 3;
  const positiveDays = [...byDay.values()].filter(v => v > 0).length;
  const consistencyScore = activeDays >= 3 ? positiveDays / activeDays * 100 : null;
  const winRate = complete.length ? winners.length / complete.length * 100 : null;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;
  const basis = closes.reduce((sum, t) => sum + t.basis, 0);
  const drawdownRatio = basis > 0 ? maxDrawdown / basis : null;
  const profitConcentration = grossProfit > 0 ? Math.max(0, ...tokenProfit.values()) / grossProfit : null;
  const holdTimes = complete.flatMap(t => t.hold == null ? [] : [t.hold]);
  const medianHoldTime = median(holdTimes);
  const returns = complete.flatMap(t => t.returnPct == null ? [] : [t.returnPct]);
  const entryCaps = selected.filter(t => t.side === "BUY" && finite(t.entryMarketCap)).map(t => t.entryMarketCap!);
  const earlyEntries = selected.filter(t => t.side === "BUY" && finite(t.tokenAgeMs));
  const earlyEntryScore = earlyEntries.length >= 10 ? earlyEntries.filter(t => t.tokenAgeMs! < 3_600_000).length / earlyEntries.length * 100 : null;
  const riskScore = sufficient && drawdownRatio != null ? clamp(drawdownRatio * 100 + Math.max(0, (profitConcentration ?? 0) - 0.5) * 60) : null;
  const components = { winRate, consistency: consistencyScore, profitFactor: profitFactor != null ? clamp(profitFactor * 25) : grossProfit > 0 ? 70 : null, drawdown: drawdownRatio != null ? clamp(100 - drawdownRatio * 100) : null, diversification: profitConcentration != null ? clamp((1 - profitConcentration) * 100) : null };
  const available = Object.values(components).filter(finite);
  const overallScore = sufficient && available.length >= 4 ? Math.round((mean(available) ?? 0) * Math.min(1, sampleConfidence / 0.6)) : null;
  const classifications: { label: string; reason: string }[] = [];
  if (sufficient && medianHoldTime != null) {
    if (medianHoldTime < 900_000) classifications.push({ label: "Scalper", reason: "At least 20 fully covered sells; median recorded holding time below 15 minutes." });
    else if (medianHoldTime < 3_600_000) classifications.push({ label: "Fast flipper", reason: "At least 20 fully covered sells; median recorded holding time below one hour." });
    else if (medianHoldTime >= 7 * 86_400_000) classifications.push({ label: "Long holder", reason: "At least 20 fully covered sells; median recorded holding time at least seven days." });
  }
  if (sufficient && consistencyScore != null && consistencyScore >= 70 && activeDays >= 7) classifications.push({ label: "Consistent", reason: "Positive recorded realized PnL on at least 70% of seven or more active closing days." });
  if (riskScore != null && riskScore >= 50) classifications.push({ label: "High recorded risk", reason: "Recorded drawdown and concentration produce a risk score of at least 50. This is a history-based measure." });
  if (earlyEntryScore != null && earlyEntryScore >= 70) classifications.push({ label: "Early buyer", reason: "At least ten entries have known chain launch times; 70% occurred within one hour of launch." });
  return { period, realizedPnl, unrealizedPnl: null as number | null, totalPnl: null as number | null, winRate, trades: selected.length, winningTrades: winners.length, losingTrades: losers.length,
    averageReturn: mean(returns), medianReturn: median(returns), profitFactor, maxDrawdown: closes.length ? maxDrawdown : null,
    averageHoldTime: mean(holdTimes), medianHoldTime, averageEntryMarketCap: mean(entryCaps), runnerHitRate: null as number | null, rugRate: null as number | null,
    earlyEntryScore, consistencyScore, riskScore, overallScore, calculatedAt: new Date(now).toISOString(),
    provenance: { source: "Analyst computed", period, calculatedAt: new Date(now).toISOString(), completeness: "partial tracked history", accounting: "realized weighted-average cost basis; gas and unobserved fees excluded", imported: false, since: rows[0] ? new Date(rows[0].timestamp).toISOString() : null, priced, total: selected.length, fullyCoveredSells: complete.length, uncoveredSells, sampleConfidence },
    details: { sufficient, activeDays, distinctTokens, grossProfit, grossLoss, profitConcentration, components, classifications, bestTrades: [...closes].sort((a, b) => b.pnl - a.pnl).slice(0, 5), worstTrades: [...closes].sort((a, b) => a.pnl - b.pnl).slice(0, 5), positions: [...inventory].map(([token, p]) => ({ token, quantity: p.quantity, costBasis: p.cost, realizedPnl: closes.some(c => c.token === token) ? closes.filter(c => c.token === token).reduce((sum, c) => sum + c.pnl, 0) : null, acquiredAt: p.acquired == null ? null : new Date(p.acquired).toISOString() })) },
  };
}
export type WalletIntelligence = ReturnType<typeof calculateWalletMetrics>;
