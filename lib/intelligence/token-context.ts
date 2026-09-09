import "server-only";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { assetCategory, cleanSymbol } from "@/lib/presentation";
import { runnerSignal, smartMoneyConsensus, type ConsensusTrade } from "./signals";

export async function tokenContext(address: string, at = Date.now()) {
  const db = await getDb();
  const [token] = await db.select().from(schema.tokens).where(eq(schema.tokens.address, address)).limit(1);
  if (!token) return null;
  const [markets, risks, indexed, imported, profiles] = await Promise.all([
    db.select().from(schema.marketObservations).where(and(eq(schema.marketObservations.tokenAddress, address), lte(schema.marketObservations.timestamp, new Date(at)))).orderBy(desc(schema.marketObservations.timestamp)).limit(180),
    db.select().from(schema.riskAssessments).where(and(eq(schema.riskAssessments.token, address), lte(schema.riskAssessments.timestamp, new Date(at)))).orderBy(desc(schema.riskAssessments.timestamp)).limit(1),
    db.select().from(schema.chainSwaps).where(and(eq(schema.chainSwaps.tokenAddress, address), gte(schema.chainSwaps.timestamp, new Date(at - 7_200_000)), lte(schema.chainSwaps.timestamp, new Date(at)))).orderBy(desc(schema.chainSwaps.timestamp)).limit(20_000),
    db.select().from(schema.trades).where(and(eq(schema.trades.tokenAddress, address), gte(schema.trades.timestamp, new Date(at - 7_200_000)), lte(schema.trades.timestamp, new Date(at)))).orderBy(desc(schema.trades.timestamp)).limit(20_000),
    db.select().from(schema.tokenProfiles).where(eq(schema.tokenProfiles.address, address)).limit(1),
  ]);
  const chainIds = new Set(indexed.map(t => `${t.txHash.toLowerCase()}:${t.walletAddress}:${t.side}`));
  const trades = [
    ...indexed.filter(t => t.attribution === 'receipt-confirmed wallet delta' || t.attribution === 'curve event participant').map(t => ({ id: t.id, hash: t.txHash, wallet: t.walletAddress, side: t.side as 'BUY' | 'SELL', usd: t.usdValue, timestamp: t.timestamp.getTime() })),
    ...imported.filter(t => !t.txHash || !chainIds.has(`${t.txHash.toLowerCase()}:${t.traderId}:${t.side}`)).map(t => ({ id: t.id, hash: t.txHash, wallet: t.traderId, side: t.side as 'BUY' | 'SELL', usd: t.amountUsd, timestamp: t.timestamp.getTime() })),
  ].sort((a, b) => b.timestamp - a.timestamp);
  const wallets = [...new Set(trades.map(t => t.wallet))];
  const metrics = wallets.length ? await db.select().from(schema.walletMetrics).where(and(inArray(schema.walletMetrics.walletAddress, wallets), eq(schema.walletMetrics.period, '30d'), lte(schema.walletMetrics.calculatedAt, new Date(at)))) : [];
  const quality = new Map(metrics.map(t => [t.walletAddress, t]));
  const measured: ConsensusTrade[] = trades.map(t => { const metric = quality.get(t.wallet); const provenance = metric?.provenance as { sampleConfidence?: number } | undefined; return { ...t, quality: metric?.overallScore ?? null, confidence: provenance?.sampleConfidence ?? 0, qualityAt: metric?.calculatedAt.getTime() ?? null }; });
  const consensus = smartMoneyConsensus(measured, at);
  const current = trades.filter(t => t.timestamp > at - 3_600_000), previous = trades.filter(t => t.timestamp <= at - 3_600_000);
  const sum = (rows: typeof trades) => rows.some(t => t.usd == null) ? null : rows.reduce((s, t) => s + t.usd!, 0);
  const market = markets[0];
  const priorHolders = markets.find(m => m.timestamp.getTime() <= at - 3_600_000 && m.holderCount != null);
  const risk = risks[0] && at - risks[0].timestamp.getTime() <= 3_600_000 ? risks[0] : null;
  const price = market?.priceUsd ?? token.price, marketCap = market?.marketCap ?? token.marketCap;
  const inputs = { at, lastTradeAt: trades[0]?.timestamp ?? null, marketObservedAt: market?.timestamp.getTime() ?? null, price, marketCap, liquidity: market?.liquidityUsd ?? null,
    volumeCurrent: sum(current), volumePrevious: sum(previous), buyersCurrent: new Set(current.filter(t => t.side === 'BUY').map(t => t.wallet)).size, buyersPrevious: new Set(previous.filter(t => t.side === 'BUY').map(t => t.wallet)).size,
    buysUsd: sum(current.filter(t => t.side === 'BUY')), sellsUsd: sum(current.filter(t => t.side === 'SELL')), smartMoneyScore: consensus.score,
    holderGrowth: market?.holderCount != null && priorHolders?.holderCount != null && priorHolders.holderCount > 0 ? (market.holderCount / priorHolders.holderCount - 1) * 100 : null,
    priceChange1h: market?.priceChange1h ?? null, riskScore: risk?.score ?? null, riskLevel: risk?.overallRisk ?? 'UNKNOWN',
  };
  return { token: { address, symbol: cleanSymbol(token.symbol), name: token.name, image: token.image, category: assetCategory(token.symbol), verifiedStock: profiles[0]?.isVerifiedStockToken ?? false }, price, marketCap, fdv: market?.fdv ?? token.fdv,
    liquidity: inputs.liquidity, volume24h: market?.volume24h ?? token.volume24h, holderCount: market?.holderCount ?? null, profile: profiles[0] ?? null,
    consensus, runner: runnerSignal(inputs), risk: risk ? { level: risk.overallRisk, score: risk.score, at: risk.timestamp.toISOString() } : { level: 'UNKNOWN', score: null, at: null },
    inputs, recentTrades: trades.slice(0, 20), observedAt: market?.timestamp.toISOString() ?? token.updatedAt.toISOString(), calculatedAt: new Date(at).toISOString(),
    coverage: { market: market ? 'observed market snapshot' : 'stored token metadata', trades: 'partial monitored contracts and imported tracked trades', source: 'Analyst computed', period: '1h' },
  };
}
export type TokenIntelligence = NonNullable<Awaited<ReturnType<typeof tokenContext>>>;
