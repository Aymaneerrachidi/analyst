import { createServer, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';
import { formatUnits, toEventSelector, zeroAddress, type Address, type Hex } from 'viem';
import { getDb, schema } from '../lib/db';
import { chainClient, tokenMetadata, verifyPool } from '../lib/indexer/rpc';
import { type RawLog } from '../lib/indexer/events';
import { verifiedWalletFills } from '../lib/indexer/webhook-receipt';
import { rpcGate, withinBudget } from '../lib/indexer/webhook-limits';
import { pauseWebhook } from '../lib/indexer/webhook-control';
import { v2Config } from '../lib/v2/config';
import { insertTrades, recomputeDerived } from '../lib/services/sync';
import { type UpstreamTrade } from '../lib/providers/types';
import { fetchMarketQuotes } from '../lib/providers/market-data';

const config = v2Config();
const required = ['DATABASE_URL', 'ALCHEMY_RPC_URL', 'ALCHEMY_NOTIFY_TOKEN', 'ALCHEMY_WEBHOOK_ID', 'INDEXER_SECRET'];
if (required.some(key => !process.env[key])) throw new Error('Missing webhook worker configuration');
const dailyLimit = Number(process.env.ALCHEMY_DAILY_CU_LIMIT ?? 600_000);
const monthlyLimit = Number(process.env.ALCHEMY_MONTHLY_CU_LIMIT ?? 20_000_000);
if (!(dailyLimit > 0 && dailyLimit <= 700_000 && monthlyLimit > 0 && monthlyLimit <= 22_000_000)) throw new Error('Unsafe free-tier budget');
const ledger = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const db = await getDb();
let state = 'starting', reason = '', stopping = false, lastNotify = 0, active = false, lastDerived = 0, dirty = false;
let processed = 0, published = 0, lastTradeAt: string | null = null, lastMarkets = 0;
const clients = new Set<ServerResponse>();
const broadcast = (event: string, data: unknown) => { for (const client of clients) { if (client.writableLength > 512_000) { client.end(); clients.delete(client); } else client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } };
const put = async (key: string, value: object) => { await db.insert(schema.appMeta).values({ key, value }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt: new Date() } }); };
async function pause(why: string) { state = 'paused'; reason = why; await pauseWebhook(); active = false; }
async function reserve(cu: number) {
  const now = new Date().toISOString(), key = `alchemy-usage:${now.slice(0, 10)}`;
  const allowed = await ledger.begin(async tx => {
    await tx`select pg_advisory_xact_lock(4663, 908)`;
    const [usage] = await tx`select coalesce(sum((value->>'cu')::bigint) filter (where key = ${key}),0)::float8 as daily, coalesce(sum((value->>'cu')::bigint),0)::float8 as monthly from app_meta where key like ${`alchemy-usage:${now.slice(0, 7)}%`}`;
    if (!withinBudget(usage.daily, usage.monthly, cu, dailyLimit, monthlyLimit)) return false;
    await tx`insert into app_meta(key,value) values(${key},${tx.json({ cu })}) on conflict(key) do update set value = jsonb_build_object('cu',coalesce((app_meta.value->>'cu')::bigint,0)+${cu}), updated_at=now()`;
    return true;
  });
  if (!allowed) { await pause('budget_limit'); throw new Error('Budget exhausted'); }
}
const client = chainClient(rpcGate(reserve));
const topics = new Map([
  [toEventSelector('Swap(address,uint256,uint256,uint256,uint256,address)'), 'uniswap-v2'],
  [toEventSelector('Swap(address,address,int256,int256,uint160,uint128,int24)'), 'uniswap-v3'],
  [toEventSelector('CurveBuy(address,address,uint256,uint256,uint256,uint256)'), 'pons-curve'],
  [toEventSelector('CurveSell(address,address,uint256,uint256,uint256,uint256)'), 'pons-curve'],
] as const);
type Inbox = { status: string; receivedAt: string; attempts?: number; retryAt?: string; event: { event: { activity: { hash: Hex; fromAddress: string; toAddress: string; log?: { removed?: boolean } }[] } } };
async function consume(key: string, value: Inbox) {
  const tracked = new Set((await db.select({ id: schema.traders.id }).from(schema.traders)).map(t => t.id));
  const hashes = [...new Set(value.event.event.activity.filter(a => tracked.has(a.fromAddress.toLowerCase()) || tracked.has(a.toAddress.toLowerCase())).map(a => a.hash))];
  const head = hashes.length ? await client.getBlockNumber({ cacheTime: 0 }) : BigInt(0);
  for (const hash of hashes) {
    const recordKey = `alchemy-receipt:${hash}`;
    const [done] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, recordKey));
    if (value.event.event.activity.some(a => a.hash === hash && a.log?.removed)) {
      await db.delete(schema.trades).where(sql`${schema.trades.txHash} = ${hash} and ${schema.trades.id} like 'webhook:%'`);
      await put(recordKey, { status: 'removed' }); dirty = true; continue;
    }
    if ((done?.value as { status?: string } | undefined)?.status === 'processed') continue;
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt.status !== 'success') { await put(recordKey, { status: 'processed', result: 'reverted' }); continue; }
    if (head - receipt.blockNumber < BigInt(config.INDEXER_CONFIRMATIONS)) throw new Error('Awaiting confirmations');
    const block = await client.getBlock({ blockNumber: receipt.blockNumber, includeTransactions: false });
    if (block.hash !== receipt.blockHash) throw new Error('Receipt not canonical');
    const logs: RawLog[] = receipt.logs.filter(l => l.logIndex != null).map(l => ({ address: l.address.toLowerCase(), topics: l.topics, data: l.data, logIndex: l.logIndex!, transactionHash: hash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber }));
    const pools = await db.select().from(schema.liquidityPools).where(eq(schema.liquidityPools.active, true));
    let discoveries = 0;
    for (const log of logs) {
      const kind = topics.get(log.topics[0]);
      if (!kind || pools.some(p => p.address === log.address)) continue;
      if (++discoveries > 8) throw new Error('Receipt requires extended discovery');
      try { pools.push(await verifyPool(client, log.address as Address, kind)); }
      catch { if (state === 'paused') throw new Error('Budget exhausted'); /* Unknown factories remain raw. */ }
    }
    const quotes = [zeroAddress, ...config.usdQuotes, ...(config.WRAPPED_NATIVE_ADDRESS ? [config.WRAPPED_NATIVE_ADDRESS] : [])];
    const fills = verifiedWalletFills(logs, pools, [...tracked], quotes);
    const rows: UpstreamTrade[] = [];
    for (const fill of fills) {
      const metadata = await tokenMetadata(client, fill.swap.tokenAddress as Address);
      const quote = await tokenMetadata(client, fill.swap.quoteAddress as Address);
      const quantity = Number(formatUnits(fill.swap.amountTokenRaw, metadata.decimals));
      const quoteAmount = Number(formatUnits(fill.swap.amountQuoteRaw, quote.decimals));
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(quoteAmount)) continue;
      const at = new Date(Number(block.timestamp) * 1000);
      const pricingAddress = fill.swap.quoteAddress === zeroAddress ? config.WRAPPED_NATIVE_ADDRESS : fill.swap.quoteAddress;
      const observation = pricingAddress ? await ledger`select price_usd from market_observations where token_address=${pricingAddress} and timestamp <= ${at} and timestamp >= ${new Date(at.getTime() - 300_000)} and price_usd > 0 order by timestamp desc limit 1` : [];
      const usd = observation[0]?.price_usd ? quoteAmount * Number(observation[0].price_usd) : undefined;
      rows.push({ id: `webhook:${hash}:${fill.wallet}:${fill.swap.tokenAddress}:${fill.swap.side}`, txHash: hash, wallet: fill.wallet, side: fill.swap.side, tokenAddress: metadata.address, tokenSymbol: metadata.symbol, tokenName: metadata.name, tokenAmount: quantity, amountUsd: usd, price: usd === undefined ? undefined : usd / quantity, nativeAmount: fill.swap.quoteAddress === config.WRAPPED_NATIVE_ADDRESS || fill.swap.quoteAddress === zeroAddress ? quoteAmount : undefined, dex: fill.pool.dex, timestamp: at.toISOString() });
    }
    const count = await insertTrades(db, rows); published += count; dirty ||= count > 0;
    if (count) { lastTradeAt = rows.at(-1)!.timestamp; broadcast('indexed', { trades: count, at: new Date().toISOString() }); }
    await put(recordKey, { status: 'processed', blockHash: block.hash, blockNumber: Number(block.number), rows: rows.map(r => r.id), result: rows.length ? 'verified_swap' : 'no_supported_wallet_swap', at: new Date().toISOString() });
  }
  await put(key, { ...value, status: 'processed', processedAt: new Date().toISOString() }); processed++;
}
async function heartbeat() {
  await reserve(0);
  if (Date.now() - lastNotify > 30_000) {
    const response = await fetch('https://dashboard.alchemy.com/api/team-webhooks', { headers: { 'X-Alchemy-Token': process.env.ALCHEMY_NOTIFY_TOKEN! }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Notify status unavailable');
    const body = await response.json();
    active = Boolean(body.data?.find((w: { id: string }) => w.id === process.env.ALCHEMY_WEBHOOK_ID)?.is_active);
    lastNotify = Date.now();
  }
  const [control] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'alchemy-control'));
  const expiresAt = (control?.value as { expiresAt?: string } | undefined)?.expiresAt;
  if (active && (!expiresAt || Date.now() >= Date.parse(expiresAt) || !Number.isFinite(Date.parse(expiresAt)))) await pause('activation_expired');
  if (state !== 'paused') state = active ? 'live' : 'waiting';
  const [backlog] = await ledger`select count(*)::int as count from app_meta where key like 'alchemy-inbox:%' and (value->>'status'='blocked' or (value->>'status'='pending' and updated_at < now()-interval '30 seconds'))`;
  if (active && backlog.count > 0 && state !== 'paused') state = 'delayed';
  const status = { at: new Date().toISOString(), status: state, reason, active, processed, published, lastTradeAt, dailyLimit, monthlyLimit };
  await put('alchemy-worker', status); broadcast('heartbeat', { upstream: state, ...status });
}
const server = createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(stopping ? 503 : 200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ service: 'webhook-consumer', status: state, active, reason, processed, published, lastTradeAt })); return; }
  const expected = Buffer.from(`Bearer ${config.INDEXER_SECRET}`), supplied = Buffer.from(req.headers.authorization ?? '');
  if (req.url !== '/events' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(`event: status\ndata: ${JSON.stringify({ upstream: state })}\n\n`); clients.add(res); req.on('close', () => clients.delete(res));
});
server.listen(config.INDEXER_PORT, '0.0.0.0');
process.on('SIGTERM', () => { stopping = true; }); process.on('SIGINT', () => { stopping = true; });
// Transactional lease avoids two deployments processing the same inbox concurrently.
while (!stopping) {
  try {
    await heartbeat();
    if (state !== 'paused') {
      if (active && Date.now() - lastMarkets > 60_000) {
        lastMarkets = Date.now();
        const quotes = await fetchMarketQuotes([...(config.WRAPPED_NATIVE_ADDRESS ? [config.WRAPPED_NATIVE_ADDRESS] : []), ...config.usdQuotes], false);
        for (const quote of quotes.values()) if (quote.price && quote.observedAt) await db.insert(schema.marketObservations).values({ tokenAddress: quote.address, timestamp: new Date(quote.observedAt), priceUsd: quote.price, source: quote.source ?? 'market API' }).onConflictDoNothing();
      }
      const records = await ledger`select key,value from app_meta where key like 'alchemy-inbox:%' and value->>'status' = 'pending' and coalesce((value->>'retryAt')::timestamptz,'epoch') <= now() order by updated_at limit 5`;
      for (const record of records) {
        const claimed = await ledger`insert into app_meta(key,value) values(${`alchemy-lease:${record.key}`},jsonb_build_object('until',now()+interval '2 minutes')) on conflict(key) do update set value=excluded.value where (app_meta.value->>'until')::timestamptz < now() returning key`;
        if (!claimed.length) continue;
        try { await consume(record.key, record.value); }
        catch { const attempts = Number(record.value.attempts ?? 0) + 1; await put(record.key, { ...record.value, attempts, status: attempts >= 12 ? 'blocked' : 'pending', retryAt: new Date(Date.now() + Math.min(60_000, 2000 * 2 ** Math.min(attempts, 5))).toISOString() }); }
        finally { await ledger`delete from app_meta where key=${`alchemy-lease:${record.key}`}`; }
      }
      if (dirty && Date.now() - lastDerived > 30_000) { await recomputeDerived(db, { providerOwnsRankings: false }); dirty = false; lastDerived = Date.now(); }
    }
  } catch { state = 'reconnecting'; reason = 'processing_error'; try { await pause('processing_error'); } catch { /* Retry the provider pause on the next cycle. */ } }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
await pause('worker_stopped'); await put('alchemy-worker', { at: new Date().toISOString(), status: 'paused', active: false });
for (const response of clients) response.end(); server.close(); await ledger.end(); process.exit(0);
