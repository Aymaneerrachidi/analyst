import 'server-only';
import { and, desc, eq, gt, gte, lt, ilike, inArray, or } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import type { AnalystTrade } from '@/lib/types';
export async function indexedTradeSnapshot(limit = 100, options: { token?: string; wallets?: string[]; side?: string; minUsd?: number; query?: string; afterSeq?: number; beforeSeq?: number } = {}): Promise<AnalystTrade[]> {
  const db = await getDb();
  const rows = await db.select({ swap: schema.chainSwaps, token: schema.tokens, trader: schema.traders }).from(schema.chainSwaps).leftJoin(schema.tokens, eq(schema.tokens.address, schema.chainSwaps.tokenAddress)).leftJoin(schema.traders, eq(schema.traders.id, schema.chainSwaps.walletAddress)).where(and(
    options.token ? eq(schema.chainSwaps.tokenAddress, options.token.toLowerCase()) : undefined,
    options.afterSeq != null ? gt(schema.chainSwaps.seq, options.afterSeq) : undefined,
    options.beforeSeq != null ? lt(schema.chainSwaps.seq, options.beforeSeq) : undefined,
    options.wallets ? inArray(schema.chainSwaps.walletAddress, options.wallets.map(a => a.toLowerCase())) : undefined,
    options.side ? eq(schema.chainSwaps.side, options.side) : undefined,
    options.minUsd ? gte(schema.chainSwaps.usdValue, options.minUsd) : undefined,
    options.query ? or(ilike(schema.tokens.symbol, `%${options.query}%`), ilike(schema.tokens.name, `%${options.query}%`), ilike(schema.chainSwaps.tokenAddress, `%${options.query}%`)) : undefined,
    or(eq(schema.chainSwaps.attribution, 'receipt-confirmed wallet delta'), eq(schema.chainSwaps.attribution, 'curve event participant')),
  )).orderBy(desc(schema.chainSwaps.blockNumber), desc(schema.chainSwaps.logIndex)).limit(limit);
  return rows.map(({ swap, token, trader }) => ({ id: swap.id, logIndex: swap.logIndex, seq: swap.seq, traderId: swap.walletAddress, trader: { id: swap.walletAddress, wallet: swap.walletAddress, name: trader?.name ?? swap.walletAddress.slice(0, 8), handle: trader?.handle ?? swap.walletAddress, avatar: trader?.avatar }, token: { address: swap.tokenAddress, symbol: token?.symbol ?? 'Unknown', name: token?.name ?? 'Unlabeled token', image: token?.image }, side: swap.side as 'BUY' | 'SELL', amountUsd: swap.usdValue, tokenAmount: Number(swap.amountToken), price: swap.executionPrice, realizedPnl: null, timestamp: swap.timestamp.toISOString(), txHash: swap.txHash }));
}

/** Worker-safe imported snapshot: no Next request lifecycle or browser-triggered refresh. */
export async function storedTradeSnapshot(limit = 200): Promise<AnalystTrade[]> {
  const db = await getDb();
  const rows = await db.select({ trade: schema.trades, token: schema.tokens, trader: schema.traders }).from(schema.trades).innerJoin(schema.tokens, eq(schema.tokens.address, schema.trades.tokenAddress)).innerJoin(schema.traders, eq(schema.traders.id, schema.trades.traderId)).orderBy(desc(schema.trades.timestamp), desc(schema.trades.seq)).limit(limit);
  return rows.map(({ trade, token, trader }) => ({ id: trade.id, seq: trade.seq, traderId: trader.id, trader: { id: trader.id, wallet: trader.wallet, name: trader.name, handle: trader.handle, avatar: trader.avatar }, token: { address: token.address, symbol: token.symbol, name: token.name, image: token.image }, side: trade.side as 'BUY' | 'SELL', amountUsd: trade.amountUsd, tokenAmount: trade.tokenAmount, price: trade.price, realizedPnl: trade.realizedPnl, timestamp: trade.timestamp.toISOString(), txHash: trade.txHash }));
}
