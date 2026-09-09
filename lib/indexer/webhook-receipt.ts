import { parseSwap, parseTransfer, type Pool, type RawLog, type ParsedSwap } from './events';

/** A transfer is not a trade. Require a verified pool fill and an exact wallet delta. */
export function verifiedWalletFills(logs: RawLog[], pools: Pool[], wallets: string[], quotes: string[]) {
  const result: { wallet: string; swap: ParsedSwap; pool: Pool; logIndex: number }[] = [];
  const transfers = logs.flatMap(log => { const transfer = parseTransfer(log); return transfer ? [{ ...transfer, token: log.address.toLowerCase() }] : []; });
  const candidates = logs.flatMap(log => {
    const pool = pools.find(p => p.address.toLowerCase() === log.address.toLowerCase());
    const swap = pool && parseSwap(log, pool, quotes);
    return pool && swap ? [{ pool, swap, logIndex: log.logIndex }] : [];
  });
  for (const wallet of [...new Set(wallets.map(w => w.toLowerCase()))]) {
    for (const candidate of candidates) {
      const { swap } = candidate;
      if (swap.wallet && (swap.wallet !== wallet || swap.recipient !== wallet)) continue;
      // Multiple fills for one token require aggregation/routing attribution. Do not
      // publish an individual fill using an aggregate wallet balance change.
      if (candidates.filter(c => c.swap.tokenAddress === swap.tokenAddress).length !== 1) continue;
      const delta = transfers.filter(t => t.token === swap.tokenAddress).reduce((sum, t) => sum + (t.to === wallet ? BigInt(t.amountRaw) : BigInt(0)) - (t.from === wallet ? BigInt(t.amountRaw) : BigInt(0)), BigInt(0));
      if (delta !== (swap.side === 'BUY' ? swap.amountTokenRaw : -swap.amountTokenRaw)) continue;
      result.push({ wallet, ...candidate });
    }
  }
  // A bundled receipt can involve several tracked wallets. Never assign one fill twice.
  return result.filter(fill => result.filter(other => other.logIndex === fill.logIndex).length === 1);
}
