import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import * as schema from "../lib/db/schema";
import { parseSwap, parseTransfer, rawEventId, v3SwapAbi, transferAbi, type RawLog } from "../lib/indexer/events";
import { ponsCurveAbi } from "../lib/indexer/contracts";
import { v2Config } from "../lib/v2/config";
import { calculateWalletMetrics, type MeasuredTrade } from "../lib/intelligence/metrics";
import { classifyRisk, holderConcentration } from '../lib/intelligence/risk-model';
import { researchChanged, researchSchema } from '../lib/intelligence/research-model';
import { runnerSignal, signalOutcome, smartMoneyConsensus } from '../lib/intelligence/signals';
import { curveEstimate, directCalldata, validateDirectExecution } from '../lib/trading/direct-shared';
import { NATIVE, type TradeQuote } from '../lib/trading/shared';

const client = new PGlite();
const db = drizzle(client, { schema });
const A = `0x${'a'.repeat(40)}` as const, B = `0x${'b'.repeat(40)}` as const, C = `0x${'c'.repeat(40)}` as const;
const hash = (c: string) => `0x${c.repeat(64)}` as Hex;
const raw = (override: Partial<RawLog> = {}): RawLog => ({ address: A, topics: [], data: '0x', logIndex: 0, transactionHash: hash('d'), blockHash: hash('1'), blockNumber: BigInt(100), ...override });
before(async () => { await migrate(db, { migrationsFolder: 'drizzle' }); Object.assign(globalThis, { __analystDb: { db } }); });
after(async () => { await client.close(); });

test('configuration validates contracts and never includes credential values in errors', () => {
  assert.throws(() => v2Config({ ALCHEMY_RPC_URL: 'private-invalid-key' }), e => e instanceof Error && !e.message.includes('private-invalid-key'));
  assert.throws(() => v2Config({ PONS_ROUTER_ADDRESS: 'bad' }));
  assert.equal(v2Config({}).INDEXER_START_BLOCK, undefined);
});

test('V3 and Pons event parsers preserve signs, participants and exact integer quantities', () => {
  const topics = encodeEventTopics({ abi: v3SwapAbi, eventName: 'Swap', args: { sender: B, recipient: C } }) as Hex[];
  const data = encodeAbiParameters([{ type: 'int256' }, { type: 'int256' }, { type: 'uint160' }, { type: 'uint128' }, { type: 'int24' }], [-BigInt(50), BigInt(100), BigInt(1), BigInt(1), 0]);
  const event = raw({ topics, data });
  assert.deepEqual(parseSwap(event, { address: A, token0: B, token1: C, kind: 'uniswap-v3', dex: 'Uniswap' }, [C]), { tokenAddress: B, quoteAddress: C, side: 'BUY', amountTokenRaw: BigInt(50), amountQuoteRaw: BigInt(100) });
  assert.equal(parseSwap(event, { address: B, token0: B, token1: C, kind: 'uniswap-v3', dex: 'Uniswap' }, [C]), null);
  assert.equal(parseSwap(event, { address: A, token0: B, token1: C, kind: 'uniswap-v3', dex: 'Uniswap' }, [B, C]), null);
  const curve = raw({ topics: encodeEventTopics({ abi: ponsCurveAbi, eventName: 'CurveBuy', args: { buyer: B, recipient: C } }) as Hex[], data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [BigInt(100), BigInt(50), BigInt(1), BigInt(0)]) });
  const parsed = parseSwap(curve, { address: A, token0: B, token1: C, kind: 'pons-curve', dex: 'Pons' }, []);
  assert.equal(parsed?.wallet, B); assert.equal(parsed?.recipient, C);
  assert.equal(parsed?.amountQuoteRaw, BigInt(100));
  assert.equal(parseTransfer(event), null);
});

test('block commits are atomic, duplicates are harmless, reorgs retain immutable raw evidence', async () => {
  const { initializeCursor, persistBlock, readCursor, rewindTo } = await import('../lib/indexer/store');
  await initializeCursor(100, hash('0'));
  const log = raw({ topics: encodeEventTopics({ abi: transferAbi, eventName: 'Transfer', args: { from: B, to: C } }) as Hex[], data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(99)]) });
  const transfer = { id: 'transfer', chainId: 4663, txHash: log.transactionHash, logIndex: 0, blockNumber: 100, blockHash: log.blockHash, timestamp: new Date(1000), tokenAddress: A, ...parseTransfer(log)! };
  const block = { number: 100, hash: hash('1'), parentHash: hash('0'), timestamp: new Date(1000), logs: [log], swaps: [], transfers: [transfer] };
  assert.equal(await persistBlock(block), true);
  assert.equal(await persistBlock(block), false);
  await assert.rejects(persistBlock({ ...block, number: 102, hash: hash('3') }), /Non-contiguous/);
  assert.equal((await readCursor())?.blockNumber, 100);
  await assert.rejects(persistBlock({ ...block, number: 101, hash: hash('2'), parentHash: hash('1') }), /Log block identity mismatch/);
  assert.equal((await db.select().from(schema.chainBlocks)).length, 1);
  await assert.rejects(db.update(schema.rawChainEvents).set({ rawData: '0x' }).where(eq(schema.rawChainEvents.id, rawEventId(log))));
  await rewindTo(99, hash('0'));
  assert.equal((await db.select().from(schema.rawChainEvents)).length, 1);
  assert.equal((await db.select().from(schema.chainTransfers)).length, 0);
  const replacementLog = { ...log, blockHash: hash('4') };
  assert.equal(await persistBlock({ ...block, hash: hash('4'), logs: [replacementLog], transfers: [{ ...transfer, blockHash: hash('4') }] }), true);
  assert.equal((await db.select().from(schema.rawChainEvents)).length, 2);
  assert.equal((await readCursor())?.blockHash, hash('4'));
  assert.equal((await db.select().from(schema.chainBlocks).where(eq(schema.chainBlocks.canonical, true))).length, 1);
});

test('wallet metrics carry earlier cost basis, exclude future trades and suppress one-lucky-trade scores', () => {
  const now = 20 * 86_400_000;
  const buy: MeasuredTrade = { id: 'buy', token: A, timestamp: now - 2 * 86_400_000, order: 1, side: 'BUY', quantity: 10, usd: 100 };
  const sell: MeasuredTrade = { ...buy, id: 'sell', order: 2, side: 'SELL', timestamp: now - 1000, usd: 1000 };
  const metrics = calculateWalletMetrics([buy, sell, { ...sell, id: 'future', timestamp: now + 1, usd: 50000 }], '24h', now);
  assert.equal(metrics.realizedPnl, 900); assert.equal(metrics.trades, 1);
  assert.equal(metrics.winRate, 100); assert.equal(metrics.overallScore, null);
  assert.equal(metrics.details.sufficient, false); assert.equal(metrics.provenance.fullyCoveredSells, 1);
  assert.equal(calculateWalletMetrics([{ ...buy, usd: null }, sell], 'all', now).realizedPnl, null);
  assert.equal(calculateWalletMetrics([{ ...buy, attribution: 'payer differs from recipient' }, sell], 'all', now).realizedPnl, null);
  const partial = calculateWalletMetrics([buy, { ...sell, quantity: 20 }], 'all', now);
  assert.equal(partial.realizedPnl, 400); assert.equal(partial.winRate, null); assert.equal(partial.provenance.uncoveredSells, 1);
});

test('risk unknowns never become safe; known hazards remain visible with incomplete coverage', () => {
  const unknown = { verifiedSource: null, proxy: null, owner: null, mint: 'UNKNOWN', blacklist: 'UNKNOWN', pause: 'UNKNOWN', top10: null, creatorPercent: null, liquidityUsd: null, creatorSellUsd: null, sellSimulation: 'UNKNOWN' } as const;
  assert.equal(classifyRisk(unknown).level, 'UNKNOWN'); assert.equal(classifyRisk(unknown).score, null);
  assert.equal(classifyRisk({ ...unknown, sellSimulation: 'FAIL' }).level, 'EXTREME');
  const concentration = holderConcentration([{ address: A, raw: '700' }, { address: B, raw: '100' }, { address: C, raw: '50' }], BigInt(1000), new Set([A]));
  assert.equal(concentration.top10, 15); assert.equal(concentration.holders.length, 2);
  assert.equal(holderConcentration([{ address: A, raw: '1001' }], BigInt(1000), new Set()).top10, null);
});

test('smart-money uses qualified wallets only and excludes future evidence', () => {
  const at = 10_000_000;
  const trades = [{ wallet: A, side: 'BUY' as const, usd: 5000, timestamp: at - 1000, quality: null, confidence: 1, qualityAt: at - 1000 }];
  assert.equal(smartMoneyConsensus(trades, at).label, 'UNRATED ACTIVITY');
  assert.equal(smartMoneyConsensus(trades, at).smartMoneyNet, null);
  const qualified = { ...trades[0], quality: 80, confidence: 0.8 };
  const result = smartMoneyConsensus([qualified, { ...qualified, wallet: B }, { ...qualified, wallet: C, timestamp: at + 1 }], at);
  assert.equal(result.highBuyers, 2); assert.equal(result.smartMoneyNet, 10000);
  assert.equal(smartMoneyConsensus([{ ...qualified, qualityAt: at + 1 }], at).score, null);
});

test('runner needs fresh meaningful liquidity and never confirms a runner with unknown risk', () => {
  const at = 10_000_000;
  const input = { at, lastTradeAt: at - 1000, marketObservedAt: at - 1000, price: 1, marketCap: 100000, liquidity: 100000, volumeCurrent: 10000, volumePrevious: 1000, buyersCurrent: 20, buyersPrevious: 3, buysUsd: 10000, sellsUsd: 100, smartMoneyScore: 100, holderGrowth: 30, priceChange1h: 100, riskScore: 0, riskLevel: 'LOW' };
  assert.equal(runnerSignal(input).signalType, 'RUNNER');
  assert.equal(runnerSignal({ ...input, riskLevel: 'UNKNOWN', riskScore: null }).signalType, 'WATCH');
  assert.equal(runnerSignal({ ...input, marketObservedAt: at - 600000 }).eligible, false);
  assert.equal(runnerSignal({ ...input, liquidity: null }).eligible, false);
  assert.equal(runnerSignal({ ...input, buyersCurrent: 1 }).eligible, false);
});

test('signal outcomes require matured observations and disclose sampling gaps', () => {
  const entry = { timestamp: 0, price: 10 };
  assert.equal(signalOutcome(entry, [{ timestamp: 300000, price: 20 }], 300000, 299999), null);
  const result = signalOutcome(entry, [{ timestamp: 300000, price: 20 }, { timestamp: 400000, price: 1000 }], 300000, 300000)!;
  assert.equal(result.returnPct, 100); assert.equal(result.complete, false); assert.equal(result.maxGain, 100);
  assert.equal(signalOutcome(entry, [{ timestamp: 500000, price: 20 }], 300000, 600000), null);
});

test('research contract validates bounds and invalidates material changes only', () => {
  const snapshot = { marketCap: 100000, liquidity: 10000, netFlow: 2000, runnerScore: 60, creatorSellUsd: 0, qualifiedBuyers: 2 };
  assert.equal(researchChanged(snapshot, { ...snapshot, marketCap: 101000 }), false);
  assert.equal(researchChanged(snapshot, { ...snapshot, liquidity: 7000 }), true);
  assert.equal(researchChanged(snapshot, { ...snapshot, netFlow: -5000 }), true);
  assert.equal(researchChanged(snapshot, { ...snapshot, creatorSellUsd: 2000 }), true);
  assert.equal(researchSchema.safeParse({ summary: 'Unsupported invented response' }).success, false);
});

test('shared cache collapses concurrent requests and retains clearly stale data on failure', async () => {
  const { sharedLoad } = await import('../lib/v2/shared-cache');
  let release!: () => void, started!: () => void, calls = 0;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = sharedLoad('test-concurrency', 60000, async () => { calls++; started(); await blocked; return { value: 42 }; });
  await entered;
  const second = await sharedLoad('test-concurrency', 60000, async () => { calls++; return { value: 9 }; });
  assert.equal(second.status, 'pending'); release(); await first;
  assert.equal((await sharedLoad('test-concurrency', 60000, async () => ({ value: 9 }))).data?.value, 42);
  assert.equal(calls, 1);
  const failed = await sharedLoad('test-concurrency', 60000, async () => { throw new Error('provider secret never returned'); }, Date.now() + 120000);
  assert.equal(failed.status, 'unavailable'); assert.equal(failed.stale, true);
  assert.deepEqual(failed.data, { value: 42 });
});

test('direct curve quotes preserve integer math and reject malicious execution changes', () => {
  const amount = BigInt(100), reserves = { quoteReserve: BigInt(10000), tokenReserve: BigInt(1000000), realQuote: BigInt(9000), feeBps: BigInt(100), taxBps: BigInt(0), sellable: BigInt(900000) };
  const estimate = curveEstimate({ ...reserves, buy: true, amount });
  assert.equal(estimate.out, BigInt(9802)); assert.equal(estimate.fee, BigInt(1));
  assert.throws(() => curveEstimate({ ...reserves, buy: false, amount: BigInt(999999999), realQuote: BigInt(1) }));
  const now = 1800000000000;
  const q: TradeQuote = { provider: 'Pons curve', executable: true, account: A, sellToken: NATIVE, buyToken: B, sellAmount: '100', buyAmount: '9802', minBuyAmount: '9703', sellDecimals: 18, buyDecimals: 18, expiresAt: now + 60000, routes: ['Pons curve'], fees: [], direct: { kind: 'pons-curve', factory: B, pool: C, codeHash: hash('1'), block: 100, priceImpact: 1, partialFill: true }, transaction: { to: C, data: '0x', value: '100' } };
  q.transaction!.data = directCalldata(q, A); validateDirectExecution(q, A, now);
  for (const invalid of [{ ...q, account: B }, { ...q, expiresAt: now }, { ...q, transaction: { ...q.transaction!, value: '101' } }, { ...q, minBuyAmount: '1' }, { ...q, transaction: { ...q.transaction!, data: directCalldata(q, B) } }]) assert.throws(() => validateDirectExecution(invalid, A, now));
});


test('canonical stream fills preserve distinct receipt logs and replace imported aggregates', async () => {
  const { mergeLiveTrades } = await import('../lib/client/live-trades');
  const trader = { id: A, wallet: A, name: 'Observed wallet', handle: A };
  const token = { address: B, symbol: 'TEST', name: 'Test fixture' };
  const aggregate = { id: 'imported', seq: 10, traderId: A, trader, token, side: 'BUY' as const, amountUsd: 30, timestamp: new Date().toISOString(), txHash: hash('c') };
  const first = { ...aggregate, id: 'chain:1', seq: 0, logIndex: 1, amountUsd: 10 };
  const second = { ...aggregate, id: 'chain:2', seq: 0, logIndex: 2, amountUsd: 20 };
  const merged = mergeLiveTrades([aggregate], [first, second], 100);
  assert.equal(merged.length, 2);
  assert.equal(merged.reduce((sum, t) => sum + t.amountUsd!, 0), 30);
  assert.equal(mergeLiveTrades(merged, [aggregate, first], 100).length, 2);
});

test('batch commit rolls every block back when any parent is inconsistent', async () => {
  const { persistBlocks, readCursor } = await import('../lib/indexer/store');
  const saved = await readCursor();
  assert.ok(saved?.blockHash);
  const n = saved.blockNumber + 1;
  const first = { number: n, hash: hash('7'), parentHash: saved.blockHash, timestamp: new Date(), logs: [], swaps: [], transfers: [] };
  const second = { ...first, number: n + 1, hash: hash('8'), parentHash: hash('f') };
  await assert.rejects(persistBlocks([first, second]), /Non-contiguous/);
  assert.equal((await readCursor())?.blockNumber, saved.blockNumber);
  assert.equal(await persistBlocks([first, { ...second, parentHash: first.hash }]), true);
  assert.equal((await readCursor())?.blockNumber, n + 1);
});


test('indexer fetches bounded ranges, advances contiguous batches and replays without duplication', async () => {
 const { ChainIndexer } = await import('../lib/indexer/engine');
 const { readCursor } = await import('../lib/indexer/store');
 const saved = await readCursor(); assert.ok(saved?.blockHash);
 const blockHash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex;
 const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
 const rpc = {
   getBlockNumber: async () => BigInt(saved.blockNumber + 29),
   getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
     const n = Number(blockNumber);
     return { number: blockNumber, hash: n === saved.blockNumber ? saved.blockHash : blockHash(n), parentHash: n === saved.blockNumber + 1 ? saved.blockHash : blockHash(n - 1), timestamp: BigInt(10000 + n) };
   },
   getLogs: async (range: { fromBlock: bigint; toBlock: bigint }) => { ranges.push(range); return []; },
 } as unknown as ConstructorParameters<typeof ChainIndexer>[0];
 const engine = new ChainIndexer(rpc, v2Config({ PONS_FACTORY_ADDRESS: A }));
 try {
   assert.equal((await engine.tick()).blocks, 23);
   assert.equal((await readCursor())?.blockNumber, saved.blockNumber + 23);
   assert.equal((await engine.tick()).blocks, 0);
   assert.ok(ranges.length >= 3);
   assert.ok(ranges.every(r => r.toBlock >= r.fromBlock && r.toBlock - r.fromBlock < BigInt(10)));
 } finally { await engine.release(); }
});
