import { createServer, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { io } from 'socket.io-client';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../lib/db';
import { insertTrades, recomputeDerived } from '../lib/services/sync';
import { parseStalkTrade, stalkGet, stalkLeaderboard } from '../lib/providers/stalkchain';
import type { UpstreamTrade } from '../lib/providers/types';
import { refreshExternalRankings } from '../lib/services/external-rankings';
import { enrichTrackedTokens } from '../lib/services/token-enrichment';
import { refreshWalletTokenSnapshot } from '../lib/services/wallet-token-data';

const missing = [!process.env.DATABASE_URL && 'DATABASE_URL', (process.env.INDEXER_SECRET?.length ?? 0) < 32 && 'INDEXER_SECRET'].filter(Boolean);
if (process.argv.includes('--check')) { console.log(JSON.stringify({ worker: 'stalkchain', ready: missing.length === 0, missing })); process.exit(missing.length ? 2 : 0); }
if (missing.length) throw new Error('Worker configuration missing');
const db = await getDb();
const put = async (key: string, value: object) => { await db.insert(schema.appMeta).values({ key, value }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt: new Date() } }); };
const clients = new Set<ServerResponse>();
const broadcast = (event: string, data: unknown) => { for (const client of clients) { if (client.writableLength > 512_000) { client.end(); clients.delete(client); } else client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } };
let tracked = new Set<string>(), walletIndex = 0, published = 0, lastEventAt = 0, sourceAgeSeconds: number | null = null, lastStatusAt = 0, lastTradeAt: string | null = null;
let stopping = false, flushing = false, dirty = false, lastDerived = 0, failures = 0, lastPoll = 0, lastRoster = 0, lastHistory = 0, nextAttempt = 0;
let pending: UpstreamTrade[] = [], cursor: string | null = null, savedCursor: string | null = null;
let stage = 'starting';
let analytics: Promise<void> | undefined;
let rankings: Promise<void> | undefined, lastRankings = 0;
let markets: Promise<void> | undefined, nextMarkets = 0;
let walletDetails: Promise<void> | undefined, nextWalletDetails = 0, detailIndex = 0;
const persisted = new Set<string>();
let databaseRetryAt = 0, lastHeartbeatWrite = 0;
const [checkpoint] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'stalkchain-cursor'));
savedCursor = (checkpoint?.value as { cursor?: string } | undefined)?.cursor ?? null;
const upstream = () => !socket.connected || Date.now() - lastStatusAt > 90_000 ? 'reconnecting' : sourceAgeSeconds !== null && sourceAgeSeconds <= 30 ? 'live' : 'delayed';
function enqueue(value: unknown, wallet?: string) {
  const row = parseStalkTrade(value, wallet);
  if (row && tracked.has(row.wallet) && !persisted.has(row.id)) pending.push(row);
  if (pending.length > 5000) { socket.disconnect(); throw new Error('Live inbox backpressure'); }
}
async function roster() {
  const [policy] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'tracking:source-policy'));
  const sources = (policy?.value as { sources?: string[] } | undefined)?.sources;
  if (sources && !sources.includes('stalkchain')) throw new Error('Stalkchain roster is not enabled');
  const response = stalkLeaderboard.parse(await stalkGet('kols/leaderboard?window=7d&sort=pnl&limit=50'));
  for (const kol of response.data.leaderboard) for (const wallet of kol.wallets) {
    await db.insert(schema.traders).values({ id: wallet, wallet, name: kol.label, handle: kol.label, avatar: kol.avatar ?? null, twitterUrl: kol.xLink?.url ?? null }).onConflictDoUpdate({ target: schema.traders.id, set: { avatar: sql`coalesce(${schema.traders.avatar}, ${kol.avatar ?? null})`, twitterUrl: sql`coalesce(${schema.traders.twitterUrl}, ${kol.xLink?.url ?? null})` } });
    await put(`wallet-source:stalkchain:${wallet}`, { source: 'Stalkchain', url: 'https://stalkchain.com/robinhood/kols', capturedAt: new Date().toISOString(), name: kol.label });
  }
  tracked = new Set((await db.select({ id: schema.traders.id }).from(schema.traders).orderBy(desc(schema.traders.lastActiveAt))).map(r => r.id));
  lastRoster = Date.now();
}
async function flush() {
  if (flushing) return;
  flushing = true;
  const batch = pending; pending = []; const batchCursor = cursor;
  try {
    if (batch.length) {
      const known = await db.select({ address: schema.tokens.address, symbol: schema.tokens.symbol, name: schema.tokens.name }).from(schema.tokens).where(inArray(schema.tokens.address, [...new Set(batch.map(t => t.tokenAddress))]));
      for (const trade of batch) { const token = known.find(t => t.address === trade.tokenAddress); if (token) { trade.tokenSymbol = token.symbol; trade.tokenName = token.name; } }
      const count = await insertTrades(db, batch); published += count; dirty ||= count > 0;
      for (const trade of batch) persisted.add(trade.id);
      while (persisted.size > 30_000) persisted.delete(persisted.values().next().value!);
      if (count) { lastTradeAt = batch.reduce((latest, row) => row.timestamp > latest ? row.timestamp : latest, lastTradeAt ?? ''); broadcast('indexed', { trades: count, at: new Date().toISOString() }); }
      await put('stalkchain-import', { at: new Date().toISOString(), imported: count, received: batch.length, source: 'Stalkchain public feed', verification: 'provider-reported', historyComplete: false });
    }
    if (batchCursor && batchCursor !== savedCursor) { await put('stalkchain-cursor', { cursor: batchCursor, at: new Date().toISOString() }); savedCursor = batchCursor; }
  } catch { pending.unshift(...batch); throw new Error('Persistence unavailable'); }
  finally { flushing = false; }
}
const socket = io('https://stalkchain.com', { autoConnect: false, transports: ['websocket'], reconnection: true, reconnectionDelay: 2000, reconnectionDelayMax: 30_000, timeout: 15000 });
socket.on('connect', () => { socket.emit('subscribe', 'robinhood_live'); socket.emit('replay', { room: 'robinhood_live', cursor: savedCursor, reason: 'connect' }); });
socket.on('robinhood.live.v1', (event: { schema?: string; type?: string; cursor?: string; row?: unknown }) => {
  if (event.schema !== 'stalkchain.robinhood.live.v1' || event.type !== 'token.projection') return;
  lastEventAt = Date.now();
  try { enqueue(event.row); if (typeof event.cursor === 'string' && /^\d+:\d+$/.test(event.cursor)) cursor = event.cursor; } catch { socket.disconnect(); }
});
const server = createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(stopping ? 503 : 200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ service: 'stalkchain-consumer', upstream: upstream(), tracked: tracked.size, published, pending: pending.length, sourceAgeSeconds, lastTradeAt, lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : null })); return; }
  const expected = Buffer.from(`Bearer ${process.env.INDEXER_SECRET}`), supplied = Buffer.from(req.headers.authorization ?? '');
  if (req.url !== '/events' || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) { res.writeHead(401); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); res.write(`event: status\ndata: ${JSON.stringify({ upstream: upstream() })}\n\n`); clients.add(res);
  // IncomingMessage closes when the GET request finishes reading, while the
  // streaming response remains open. Remove subscribers only on response close.
  res.on('close', () => clients.delete(res));
});
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
// Source/history requests can take longer than the browser's liveness window.
// Transport heartbeats must not wait for those requests or write to the database.
const transportHeartbeat = setInterval(() => broadcast('heartbeat', {
  upstream: upstream(), at: new Date().toISOString(), lastTradeAt, sourceAgeSeconds,
}), 5000);
process.on('SIGTERM', () => { stopping = true; }); process.on('SIGINT', () => { stopping = true; });
while (!stopping) {
  if (Date.now() < databaseRetryAt) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
  try {
    if (Date.now() >= nextAttempt) {
      stage = 'roster';
      if (!tracked.size || Date.now() - lastRoster > 3_600_000) await roster();
      if (!socket.connected && !socket.active) socket.connect();
      if (Date.now() - lastPoll > 20_000) {
        stage = 'feed';
        const feed = await stalkGet('kols/feed?limit=100');
        if (!Array.isArray(feed.data?.feed)) throw new Error('Invalid feed');
        for (const row of feed.data.feed) enqueue(row);
        const status = await stalkGet('status');
        sourceAgeSeconds = typeof status.data?.live?.ageSeconds === 'number' ? status.data.live.ageSeconds : null;
        lastStatusAt = Date.now(); lastPoll = Date.now();
      }
      // Sequential public history reads recover recent activity for existing KOLHOOD
      // and Defined wallets too. This is a rolling recent-history import, not full history.
      if (Date.now() - lastHistory > 3000 && tracked.size) {
        stage = 'history';
        const wallets = [...tracked]; const wallet = wallets[walletIndex++ % wallets.length];
        lastHistory = Date.now();
        try {
          const history = await stalkGet(`wallet/${wallet}/activity?limit=100`);
          if (!Array.isArray(history.data?.activity)) throw new Error('Invalid history');
          for (const row of history.data.activity) enqueue(row, wallet);
          await put(`stalkchain-history:${wallet}`, { at: new Date().toISOString(), recentRows: history.data.activity.length, hasMore: history.data.meta?.hasMore ?? null });
        } catch { await put(`stalkchain-history:${wallet}`, { at: new Date().toISOString(), status: 'unavailable' }); nextAttempt = Date.now() + 30_000; }
      }
      failures = 0;
    }
    stage = 'persist'; await flush();
    stage = 'analytics';
    const status = { at: new Date().toISOString(), status: upstream(), sourceAgeSeconds, tracked: tracked.size, published, lastTradeAt, pending: pending.length, historyComplete: false };
    if (Date.now() - lastHeartbeatWrite >= 15_000) { await put('stalkchain-worker', status); lastHeartbeatWrite = Date.now(); }
    if (process.env.CODEX_API_KEY && tracked.size && !walletDetails && Date.now() >= nextWalletDetails) {
      nextWalletDetails = Date.now() + 60_000;
      const wallets = [...tracked];
      walletDetails = refreshWalletTokenSnapshot(wallets[detailIndex++ % wallets.length]).then(() => {}).catch(() => {
        nextWalletDetails = Date.now() + 900_000;
        console.error('{"event":"wallet_details_failed"}');
      }).finally(() => { walletDetails = undefined; });
    }
    if (!markets && Date.now() >= nextMarkets) {
      nextMarkets = Date.now() + 60_000;
      markets = enrichTrackedTokens().then(() => {}).catch(() => {
        nextMarkets = Date.now() + 300_000;
        console.error('{"event":"market_enrichment_failed"}');
      }).finally(() => { markets = undefined; });
    }
    if (!rankings && Date.now() - lastRankings > 900_000) {
      lastRankings = Date.now();
      rankings = refreshExternalRankings().then(result => put('leaderboard:refresh', { ...result, at: new Date().toISOString() })).catch(() => put('leaderboard:refresh', { status: 'unavailable', at: new Date().toISOString() })).finally(() => { rankings = undefined; });
    }
    // Historical analytics must never block receipt of the next live trade.
    if (dirty && !analytics && Date.now() - lastDerived > 900_000) {
      dirty = false; lastDerived = Date.now();
      analytics = recomputeDerived(db, { providerOwnsRankings: false }).catch(() => { dirty = true; console.error('{"event":"analytics_failed"}'); }).finally(() => { analytics = undefined; });
    }
  } catch { failures++; console.error(JSON.stringify({ event: 'cycle_failed', stage, failures })); nextAttempt = Date.now() + Math.min(120_000, 5000 * 2 ** Math.min(failures, 5)); databaseRetryAt = nextAttempt; }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
clearInterval(transportHeartbeat); socket.disconnect(); await flush(); await put('stalkchain-worker', { at: new Date().toISOString(), status: 'offline' }); for (const client of clients) client.end(); server.close(); await Promise.allSettled([analytics, markets, rankings, walletDetails]); process.exit(0);
