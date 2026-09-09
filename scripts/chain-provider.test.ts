import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../lib/db/schema';

process.env.DATA_PROVIDER = 'chain';
const client = new PGlite();
const db = drizzle(client, { schema });
before(async () => {
  await migrate(db, { migrationsFolder: 'drizzle' });
  Object.assign(globalThis, { __analystDb: { db } });
});
after(async () => { await client.close(); });

test('chain mode cannot fall back to mock data or legacy network ingestion', async () => {
  const { getProvider } = await import('../lib/providers');
  const { runSync, ensureBootstrapped, ensureFresh, refreshTraderProfiles } = await import('../lib/services/sync');
  assert.equal(getProvider().name, 'chain');
  assert.equal(getProvider().isMock, false);
  await assert.rejects(getProvider().fetchTrades({ limit: 10 }), /worker/);
  await assert.rejects(runSync('full'), /Legacy sync disabled/);
  await ensureBootstrapped();
  await ensureFresh('trades', 0);
  await refreshTraderProfiles(['0x' + 'a'.repeat(40)]);
  assert.equal((await db.select().from(schema.dataSourceSyncs)).length, 0);
  assert.equal((await db.select().from(schema.trades)).length, 0);
});

test('chain freshness follows confirmed cursor state, not successful legacy sync or swap frequency', async () => {
  const { getFreshness } = await import('../lib/services/sync');
  await db.insert(schema.dataSourceSyncs).values({ provider: 'kolhood', kind: 'trades', status: 'ok', finishedAt: new Date() });
  assert.equal((await getFreshness()).status, 'offline');
  await db.insert(schema.chainCursors).values({ name: 'robinhood-confirmed', chainId: 4663, startBlock: 100, blockNumber: 101, status: 'catching_up' });
  assert.equal((await getFreshness()).status, 'delayed');
  await db.update(schema.chainCursors).set({ status: 'live', updatedAt: new Date() }).where(eq(schema.chainCursors.name, 'robinhood-confirmed'));
  const live = await getFreshness();
  assert.equal(live.status, 'live');
  assert.equal(live.lastTradeAt, null);
  await db.update(schema.chainCursors).set({ updatedAt: new Date(Date.now() - 120000) }).where(eq(schema.chainCursors.name, 'robinhood-confirmed'));
  assert.equal((await getFreshness()).status, 'delayed');
});

test('incremental legacy polling reconciles canonical fills without bypassing filters', async () => {
  const { listTrades } = await import('../lib/services/intelligence');
  const wallet = '0x' + 'a'.repeat(40), token = '0x' + 'b'.repeat(40), quote = '0x' + 'c'.repeat(40);
  await db.insert(schema.chainSwaps).values({ id: 'chain-poll-fixture', chainId: 4663, txHash: '0x' + 'd'.repeat(64), logIndex: 2,
    blockNumber: 101, blockHash: '0x' + 'e'.repeat(64), timestamp: new Date(), walletAddress: wallet, tokenAddress: token,
    quoteAddress: quote, side: 'BUY', amountToken: '10', amountQuote: '1', usdValue: 100, executionPrice: 10,
    dex: 'test fixture', poolAddress: quote, attribution: 'receipt-confirmed wallet delta' });
  const rows = await listTrades({ afterSeq: 0, traderId: wallet });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].logIndex, 2);
  assert.equal(rows[0].amountUsd, 100);
  assert.ok(rows[0].seq > 0);
  assert.equal((await listTrades({ afterSeq: rows[0].seq })).length, 0);
  assert.equal((await listTrades({ beforeSeq: rows[0].seq + 1 })).length, 1);
  assert.equal((await listTrades({ beforeSeq: rows[0].seq })).length, 0);
  assert.equal((await listTrades({ afterSeq: 0, filter: 'sells' })).length, 0);
  assert.equal((await listTrades({ afterSeq: 0, filter: 'top' })).length, 0);
  assert.equal((await listTrades({ afterSeq: 0, traderId: quote })).length, 0);
});
