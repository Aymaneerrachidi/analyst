import 'server-only';
import { createHash } from 'node:crypto';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { erc20Abi, formatUnits, type Address, type Hex } from 'viem';
import { getDb, schema } from '@/lib/db';
import { chainClient, tokenMetadata } from '@/lib/indexer/rpc';
import { parseTransfer, type RawLog } from '@/lib/indexer/events';
import { v2Config } from '@/lib/v2/config';
import { tokenContext, type TokenIntelligence } from './token-context';
import { compareThesis } from './thesis';
export async function recordPosition(wallet: Address, token: Address, hash: Hex) {
  const rpc = chainClient(), db = await getDb(), config = v2Config();
  if (await rpc.getChainId() !== 4663) throw new Error('Wrong chain.');
  const [receipt, tx, head] = await Promise.all([rpc.getTransactionReceipt({ hash }), rpc.getTransaction({ hash }), rpc.getBlockNumber({ cacheTime: 0 })]);
  if (receipt.status !== 'success' || tx.from.toLowerCase() !== wallet || receipt.from.toLowerCase() !== wallet) throw new Error('Successful receipt from this wallet required.');
  if (head - receipt.blockNumber + BigInt(1) < BigInt(config.INDEXER_CONFIRMATIONS)) return { status: 'pending' as const, confirmationsRequired: config.INDEXER_CONFIRMATIONS };
  const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash) throw new Error('Receipt is no longer canonical.');
  const [pool] = tx.to ? await db.select().from(schema.liquidityPools).where(eq(schema.liquidityPools.address, tx.to.toLowerCase())).limit(1) : [];
  if (!tx.to || !(pool?.kind === 'pons-curve' && pool.factory === config.PONS_FACTORY_ADDRESS || tx.to.toLowerCase() === config.UNISWAP_ROUTER_ADDRESS || tx.to.toLowerCase() === config.UNISWAP_V4_ROUTER)) throw new Error('This receipt is not from a configured direct route.');
  let net = BigInt(0);
  for (const log of receipt.logs) if (log.address.toLowerCase() === token && log.logIndex != null) { const parsed = parseTransfer({ ...log, address: token, topics: [...log.topics], logIndex: log.logIndex, transactionHash: hash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber } as RawLog); if (parsed) { if (parsed.to === wallet) net += BigInt(parsed.amountRaw); if (parsed.from === wallet) net -= BigInt(parsed.amountRaw); } }
  const meta = await tokenMetadata(rpc, token), current = await rpc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] });
  if (net <= BigInt(0)) { await refreshPositions(wallet); return { status: 'updated' as const, message: 'No net token acquisition in this receipt; existing balances refreshed.' }; }
  // Current intelligence is not backdated to an old receipt. Entry context must predate the transaction.
  const timestamp = new Date(Number(block.timestamp) * 1000);
  const [entrySignal] = await db.select().from(schema.tokenSignals).where(and(eq(schema.tokenSignals.token, token), lte(schema.tokenSignals.timestamp, timestamp), gte(schema.tokenSignals.timestamp, new Date(timestamp.getTime() - 300_000)))).orderBy(desc(schema.tokenSignals.timestamp)).limit(1);
  const [entryMarket] = await db.select().from(schema.marketObservations).where(and(eq(schema.marketObservations.tokenAddress, token), lte(schema.marketObservations.timestamp, timestamp), gte(schema.marketObservations.timestamp, new Date(timestamp.getTime() - 300_000)))).orderBy(desc(schema.marketObservations.timestamp)).limit(1);
  const indexed = await db.select().from(schema.chainSwaps).where(and(eq(schema.chainSwaps.txHash, hash), eq(schema.chainSwaps.walletAddress, wallet), eq(schema.chainSwaps.tokenAddress, token), eq(schema.chainSwaps.side, 'BUY')));
  const amount = formatUnits(net, meta.decimals);
  const complete = indexed.length > 0 && indexed.every(s => s.usdValue != null && s.attribution === 'receipt-confirmed wallet delta' || s.usdValue != null && s.attribution === 'curve event participant');
  const indexedAmount = indexed.reduce((sum, swap) => sum + Number(swap.amountToken), 0);
  const totalCost = complete && Math.abs(indexedAmount - Number(amount)) <= Math.max(1e-12, Number(amount) * 1e-9) ? indexed.reduce((sum, swap) => sum + swap.usdValue!, 0) : null;
  const row = { id: createHash('sha256').update(`${wallet}:${token}:${hash}`).digest('hex'), wallet, token, entryTransaction: hash, entryPrice: totalCost != null ? totalCost / Number(amount) : null, entryMarketCap: entryMarket?.marketCap ?? null, amount, totalCost, openedAt: timestamp, currentAmount: formatUnits(current, meta.decimals), realizedPnl: null, receiptBlock: Number(receipt.blockNumber), updatedAt: new Date(), thesis: { entry: entrySignal?.inputs ?? null, entryObservedAt: entrySignal?.timestamp.toISOString() ?? null, receiptHash: receipt.blockHash, source: 'confirmed chain receipt and net ERC-20 transfer logs', coverage: 'gas excluded; execution USD unavailable unless indexed quote value is known', balanceScope: 'current entire wallet token balance; not allocated to individual entries' } };
  await db.insert(schema.userPositions).values(row).onConflictDoNothing();
  return { status: 'recorded' as const, id: row.id };
}
export async function refreshPositions(wallet: Address) {
  const db = await getDb(), rpc = chainClient();
  const positions = await db.select().from(schema.userPositions).where(eq(schema.userPositions.wallet, wallet)).orderBy(desc(schema.userPositions.openedAt)).limit(100);
  for (const position of positions) {
    if (!(position.thesis as { receiptNeedsRecheck?: boolean }).receiptNeedsRecheck) continue;
    const receipt = await rpc.getTransactionReceipt({ hash: position.entryTransaction as Hex }).catch(() => null);
    const block = receipt ? await rpc.getBlock({ blockNumber: receipt.blockNumber }) : null;
    if (receipt?.status === 'success' && receipt.blockHash === block?.hash && receipt.blockHash === (position.thesis as { receiptHash?: string }).receiptHash) {
      await db.update(schema.userPositions).set({ thesis: { ...position.thesis as Record<string, unknown>, receiptNeedsRecheck: false } }).where(eq(schema.userPositions.id, position.id));
    }
  }
  for (const token of new Set(positions.filter(p => !(p.thesis as { receiptNeedsRecheck?: boolean }).receiptNeedsRecheck).map(p => p.token))) {
    const meta = await tokenMetadata(rpc, token as Address), balance = await rpc.readContract({ address: token as Address, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] });
    await db.update(schema.userPositions).set({ currentAmount: formatUnits(balance, meta.decimals), updatedAt: new Date() }).where(and(eq(schema.userPositions.wallet, wallet), eq(schema.userPositions.token, token), sql`coalesce(${schema.userPositions.thesis}->>'receiptNeedsRecheck', 'false') <> 'true'`));
  }
}
export async function positionsForWallet(wallet: Address) {
  const db = await getDb();
  const rows = await db.select({ position: schema.userPositions, token: schema.tokens }).from(schema.userPositions).leftJoin(schema.tokens, eq(schema.tokens.address, schema.userPositions.token)).where(eq(schema.userPositions.wallet, wallet)).orderBy(desc(schema.userPositions.openedAt)).limit(100);
  const contexts = new Map<string, TokenIntelligence | null>();
  for (const token of new Set(rows.map(r => r.position.token))) contexts.set(token, await tokenContext(token));
  return rows.map(({ position, token }) => ({ ...position, symbol: token?.symbol ?? position.token.slice(0, 8), comparison: (position.thesis as { receiptNeedsRecheck?: boolean }).receiptNeedsRecheck ? { status: 'Receipt needs recheck', changes: ['The entry was affected by a chain reorganization. Balance and thesis evaluation are suspended.'], coverage: 'Unconfirmed entry' } : compareThesis((position.thesis as { entry?: TokenIntelligence | null }).entry ?? null, contexts.get(position.token) ?? null), currentPrice: contexts.get(position.token)?.price ?? null }));
}
