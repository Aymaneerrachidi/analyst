import "server-only";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { calculateWalletMetrics, type MeasuredTrade, type MetricPeriod, type WalletIntelligence } from "./metrics";

export async function walletHistory(wallet: string, now = Date.now()): Promise<MeasuredTrade[]> {
  const db = await getDb();
  const [indexed, imported] = await Promise.all([
    db.select().from(schema.chainSwaps).where(and(eq(schema.chainSwaps.walletAddress, wallet), lte(schema.chainSwaps.timestamp, new Date(now)))).orderBy(desc(schema.chainSwaps.blockNumber), desc(schema.chainSwaps.logIndex)).limit(100_000),
    db.select().from(schema.trades).where(and(eq(schema.trades.traderId, wallet), lte(schema.trades.timestamp, new Date(now)))).orderBy(desc(schema.trades.timestamp), desc(schema.trades.seq)).limit(100_000),
  ]);
  const chainIdentities = new Set(indexed.map(t => `${t.txHash.toLowerCase()}:${t.tokenAddress}:${t.side}`));
  const rows: MeasuredTrade[] = indexed.map(t => ({ id: t.id, token: t.tokenAddress, timestamp: t.timestamp.getTime(), order: t.blockNumber * 100_000 + t.logIndex, side: t.side as 'BUY' | 'SELL', quantity: Number(t.amountToken), usd: t.usdValue, attribution: t.attribution }));
  for (const t of imported) {
    if (t.txHash && chainIdentities.has(`${t.txHash.toLowerCase()}:${t.tokenAddress}:${t.side}`)) continue;
    rows.push({ id: t.id, token: t.tokenAddress, timestamp: t.timestamp.getTime(), order: t.seq, side: t.side as 'BUY' | 'SELL', quantity: t.tokenAmount, usd: t.amountUsd });
  }
  const addresses = [...new Set(rows.map(t => t.token))];
  if (!addresses.length) return rows;
  const [profiles, observations] = await Promise.all([
    db.select().from(schema.tokenProfiles).where(inArray(schema.tokenProfiles.address, addresses)),
    db.select().from(schema.marketObservations).where(and(inArray(schema.marketObservations.tokenAddress, addresses), lte(schema.marketObservations.timestamp, new Date(now)))).orderBy(schema.marketObservations.timestamp).limit(100_000),
  ]);
  const launches = new Map(profiles.map(t => [t.address, t.createdAtChain?.getTime()]));
  const byToken = new Map<string, typeof observations>();
  for (const point of observations) { const list = byToken.get(point.tokenAddress) ?? []; list.push(point); byToken.set(point.tokenAddress, list); }
  for (const t of rows) {
    const launch = launches.get(t.token);
    t.tokenAgeMs = launch != null && launch <= t.timestamp ? t.timestamp - launch : null;
    const prior = (byToken.get(t.token) ?? []).findLast(p => p.timestamp.getTime() <= t.timestamp);
    t.entryMarketCap = prior && t.timestamp - prior.timestamp.getTime() <= 300_000 ? prior.marketCap : null;
  }
  return rows;
}

export async function refreshWalletMetrics(now = Date.now()) {
  const db = await getDb();
  const [tracked, indexed] = await Promise.all([db.select({ wallet: schema.traders.id }).from(schema.traders).limit(1000), db.select({ wallet: schema.wallets.address }).from(schema.wallets).orderBy(desc(schema.wallets.lastSeen)).limit(1000)]);
  const candidates = [...new Set([...tracked, ...indexed].map(t => t.wallet))].sort();
  const [rotation] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'v2:wallet-rotation')).limit(1);
  const offset = Number((rotation?.value as { offset?: number } | undefined)?.offset ?? 0) % Math.max(1, candidates.length);
  const wallets = [...candidates.slice(offset), ...candidates.slice(0, offset)].slice(0, 25);
  let count = 0;
  for (const wallet of wallets) {
    const history = await walletHistory(wallet, now);
    if (!history.length) continue;
    for (const period of ['24h', '7d', '30d', 'all'] as const) {
      const metrics = calculateWalletMetrics(history, period, now);
      const row = { id: `${wallet}:${period}`, walletAddress: wallet, ...metrics, calculatedAt: new Date(metrics.calculatedAt) };
      await db.insert(schema.walletMetrics).values(row).onConflictDoUpdate({ target: schema.walletMetrics.id, set: row });
      if (period === 'all') for (const position of metrics.details.positions) {
        const related = history.filter(t => t.token === position.token).sort((a, b) => a.timestamp - b.timestamp || a.order - b.order);
        const buys = related.filter(t => t.side === 'BUY'), sells = related.filter(t => t.side === 'SELL');
        const sum = (items: MeasuredTrade[]) => items.length && items.every(t => t.usd != null) ? items.reduce((s, t) => s + t.usd!, 0) : null;
        const row = { id: `${wallet}:${position.token}`, wallet, token: position.token, amount: position.quantity == null ? null : String(position.quantity), costBasis: position.costBasis, realizedPnl: position.realizedPnl,
          firstBuy: buys[0] ? new Date(buys[0].timestamp) : null, latestBuy: buys.at(-1) ? new Date(buys.at(-1)!.timestamp) : null, latestSell: sells.at(-1) ? new Date(sells.at(-1)!.timestamp) : null,
          totalBought: sum(buys), totalSold: sum(sells), status: position.quantity == null ? 'uncovered' : position.quantity > 0 ? 'recorded open' : 'recorded closed', details: { coverage: metrics.provenance, balance: 'inferred from recorded trades; not on-chain balance' }, calculatedAt: new Date(now) };
        await db.insert(schema.walletTokenPositions).values(row).onConflictDoUpdate({ target: schema.walletTokenPositions.id, set: row });
      }
    }
    count++;
  }
  await db.insert(schema.appMeta).values({ key: 'v2:wallet-rotation', value: { offset: offset + wallets.length, total: candidates.length } }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value: { offset: offset + wallets.length, total: candidates.length }, updatedAt: new Date(now) } });
  return count;
}

export async function getWalletIntelligence(wallet: string, period: MetricPeriod = '30d'): Promise<WalletIntelligence | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.walletMetrics).where(and(eq(schema.walletMetrics.walletAddress, wallet), eq(schema.walletMetrics.period, period))).limit(1);
  if (!row) return null;
  return { ...row, period, calculatedAt: row.calculatedAt.toISOString(), provenance: row.provenance as WalletIntelligence['provenance'], details: row.details as WalletIntelligence['details'] };
}
