export interface PerformanceTrade { tokenAddress: string; symbol: string; side: string; amountUsd: number | null; tokenAmount: number | null; timestamp: Date; }
export function analyzePerformance(rows: PerformanceTrade[]) {
  const groups = new Map<string, PerformanceTrade[]>();
  for (const row of rows) { const list = groups.get(row.tokenAddress) ?? []; list.push(row); groups.set(row.tokenAddress, list); }
  return [...groups].map(([address, trades]) => {
    trades.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    let qty = 0, cost = 0, acquired = 0, buyQty = 0, buyUsd = 0, sellQty = 0, sellUsd = 0;
    let priced = 0, matchedSells = 0, uncoveredSells = 0, pnl = 0, holdWeighted = 0, holdWeight = 0;
    let completeBuys = true, completeSells = true, inventoryKnown = true;
    for (const t of trades) {
      const amount = t.tokenAmount, usd = t.amountUsd, at = t.timestamp.getTime();
      if (amount == null || !Number.isFinite(amount) || amount <= 0 || usd == null || !Number.isFinite(usd) || usd < 0 || !Number.isFinite(at)) {
        if (t.side === "BUY") completeBuys = false; else { completeSells = false; uncoveredSells++; }
        inventoryKnown = false; continue;
      }
      priced++;
      if (t.side === "BUY") {
        buyQty += amount; buyUsd += usd;
        if (inventoryKnown) { acquired = (acquired * qty + at * amount) / (qty + amount); qty += amount; cost += usd; }
      } else {
        sellQty += amount; sellUsd += usd;
        if (!inventoryKnown || qty <= 0) { uncoveredSells++; continue; }
        const matched = Math.min(amount, qty), basis = cost * matched / qty;
        pnl += usd * matched / amount - basis;
        holdWeighted += Math.max(0, at - acquired) * basis; holdWeight += basis;
        matchedSells++; if (amount > qty) uncoveredSells++;
        qty = Math.max(0, qty - matched); cost = Math.max(0, cost - basis);
      }
    }
    return { address, symbol: trades[0].symbol, trades: trades.length, priced, matchedSells, uncoveredSells,
      averageEntry: completeBuys && buyQty > 0 ? buyUsd / buyQty : null,
      averageExit: completeSells && sellQty > 0 ? sellUsd / sellQty : null,
      holdingMs: holdWeight > 0 ? holdWeighted / holdWeight : null,
      recordedOpenQuantity: inventoryKnown ? qty : null,
      realizedPnl: matchedSells ? pnl : null,
      firstAt: trades[0].timestamp.toISOString(), lastAt: trades.at(-1)!.timestamp.toISOString() };
  }).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
export type TokenPerformance = ReturnType<typeof analyzePerformance>[number];
