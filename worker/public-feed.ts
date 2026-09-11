import { randomUUID } from 'node:crypto';
import { and, eq, like, isNull, sql } from 'drizzle-orm';
import { decodeAbiParameters } from 'viem';
import { getDb, schema } from '../lib/db';
import { insertTrades } from '../lib/services/sync';
import { normalizeMovement, receiptMovements, TRANSFER, USDG, type Receipt, type TokenMeta } from '../lib/providers/public-receipt';

const HTTP = 'https://robinhood-rpc.publicnode.com';
const SCAN_HTTP = 'https://rpc.mainnet.chain.robinhood.com';
const WS = 'wss://robinhood-rpc.publicnode.com';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hex = (n: number) => '0x' + n.toString(16);
type Log = { transactionHash: string; blockNumber: string; removed?: boolean };
export function startPublicFeed(onInsert: (count: number, timestamp: string) => void) {
  const state = { enabled: true, connected: false, head: 0, cursor: 0, pending: 0, received: 0, inserted: 0, skipped: 0, rpcRequests: 0, lastHeadAt: 0, lastProgressAt: 0, tracked: 0, lastLatencyMs: null as number | null, lastTradeAt: null as string | null, error: null as string | null };
  if (process.env.PUBLIC_RPC_FEED_ENABLED === '0') { state.enabled = false; return { state, stop: async () => {} }; }
  const owner = randomUUID();
  let renew = async () => {}, release = async () => {};
  let stopped = false, socket: WebSocket | undefined, reconnectAt = 0, lastRoster = 0, lastQuote = 0, lastState = 0, nextScan = 0;
  let wallets = new Set<string>(), quote: { price: number; at: number } | undefined;
  const meta = new Map<string, TokenMeta>(), queue = new Map<string, number>(), seen = new Set<string>(), removed = new Set<string>();
  let calls: number[] = [], lastCall = 0, requestId = 0;
  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    await renew();
    calls = calls.filter(t => Date.now() - t < 60_000);
    if (calls.length >= 60) await sleep(Math.max(1, 60_001 - (Date.now() - calls[0])));
    await sleep(Math.max(0, (method === 'eth_getLogs' ? 1500 : 1100) - (Date.now() - lastCall)));
    if (stopped) throw new Error('stopping');
    lastCall = Date.now(); calls.push(lastCall); state.rpcRequests++;
    const r = await fetch(method === 'eth_getLogs' ? SCAN_HTTP : HTTP, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }), signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new Error(`public_rpc_${method}_http_${r.status}`);
    const body = await r.json();
    if (body.error) throw new Error(`public_rpc_${body.error.code}`);
    if (body.result == null) throw new Error(`public_rpc_missing_${method}`);
    return body.result as T;
  }
  function enqueue(log: Log) {
    if (!/^0x[0-9a-f]{64}$/i.test(log.transactionHash)) return;
    if (log.removed) { removed.add(log.transactionHash); seen.delete(log.transactionHash); return; }
    const block = Number(log.blockNumber);
    if (seen.has(log.transactionHash) || queue.has(log.transactionHash) || !Number.isSafeInteger(block)) return;
    // Do not silently drop a gap: the persisted scan cursor replays after backpressure.
    if (queue.size >= 1000) { socket?.close(); state.connected = false; return; }
    queue.set(log.transactionHash, block); state.received++;
  }
  function connect() {
    socket?.close(); state.connected = false;
    const current = new WebSocket(WS); socket = current;
    const topics = [...wallets].map(w => '0x' + w.slice(2).padStart(64, '0'));
    const subscribed = new Set<string>();
    current.onopen = () => {
      current.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }));
      current.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_subscribe', params: ['logs', { topics: [TRANSFER, topics] }] }));
      current.send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_subscribe', params: ['logs', { topics: [TRANSFER, null, topics] }] }));
      current.send(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'eth_blockNumber', params: [] }));
    };
    let chainOk = false;
    current.onmessage = event => {
      if (socket !== current) return;
      try {
        const d = JSON.parse(String(event.data));
        if (d.error) { state.error = 'public_socket_request_failed'; current.close(); return; }
        if (d.id === 1) { chainOk = Number(d.result) === 4663; if (!chainOk) current.close(); }
        if ((d.id === 2 || d.id === 3) && typeof d.result === 'string') subscribed.add(d.result);
        state.connected = chainOk && subscribed.size === 2;
        if (d.id === 4 && /^0x[0-9a-f]+$/i.test(d.result)) { state.head = Number(d.result); state.lastHeadAt = Date.now(); }
        if (state.connected && subscribed.has(d.params?.subscription)) enqueue(d.params.result);
      } catch { state.error = 'public_socket_invalid_message'; }
    };
    current.onerror = () => { if (socket === current) { state.connected = false; state.error = 'public_socket_unavailable'; current.close(); } };
    current.onclose = () => { if (socket === current) { state.connected = false; reconnectAt = Date.now() + 15_000; } };
  }
  const heartbeat = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      if (state.lastHeadAt && Date.now() - state.lastHeadAt > 45_000) socket.close();
      else socket.send(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'eth_blockNumber', params: [] }));
    }
  }, 5000);
  async function run() {
    lastRoster = 0;
    const db = await getDb();
    let nextLease = 0;
    renew = async () => {
      if (Date.now() < nextLease) return;
      const rows = await db.insert(schema.appMeta).values({ key: 'public-feed:lease', value: { owner } }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value: { owner }, updatedAt: new Date() }, setWhere: sql`${schema.appMeta.value}->>'owner' = ${owner} or ${schema.appMeta.updatedAt} < now() - interval '90 seconds'` }).returning({ key: schema.appMeta.key });
      if (!rows.length) { socket?.close(); state.connected = false; throw new Error('public_feed_standby'); }
      nextLease = Date.now() + 15_000;
    };
    release = async () => { await db.delete(schema.appMeta).where(and(eq(schema.appMeta.key, 'public-feed:lease'), sql`${schema.appMeta.value}->>'owner' = ${owner}`)); };
    await renew();
    const put = async (key: string, value: object) => { await db.insert(schema.appMeta).values({ key, value }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt: new Date() } }); };
    const [checkpoint] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'public-feed:cursor'));
    state.cursor = Number((checkpoint?.value as { block?: number })?.block ?? 0);
    const unpriced = await db.select({ hash: schema.trades.txHash }).from(schema.trades).where(and(like(schema.trades.id, 'public:4663:%'), isNull(schema.trades.amountUsd))).limit(100);
    for (const r of unpriced) if (r.hash) queue.set(r.hash, 0);
    const known = await db.select({ token: schema.tokens, profile: schema.tokenProfiles }).from(schema.tokenProfiles).innerJoin(schema.tokens, eq(schema.tokens.address, schema.tokenProfiles.address));
    for (const r of known) if (r.profile.decimals != null) meta.set(r.token.address, { symbol: r.token.symbol, name: r.token.name, decimals: r.profile.decimals });
    async function report() {
      if (Date.now() - lastState < 15_000) return;
      state.pending = queue.size;
      await put('public-feed:worker', { ...state, at: new Date().toISOString(), tracked: wallets.size, status: state.connected && Date.now() - state.lastHeadAt < 30_000 && !state.error && queue.size < 100 ? 'live' : 'delayed', quoteAt: quote ? new Date(quote.at).toISOString() : null, coverage: 'Uniswap v4; unambiguous wallet/relay USDG settlement; other routes use backup', historyComplete: false });
      lastState = Date.now();
    }
    async function metadata(token: string): Promise<TokenMeta> {
      const cached = meta.get(token); if (cached) return cached;
      const decimals = Number(BigInt(await rpc<string>('eth_call', [{ to: token, data: '0x313ce567' }, 'latest'])));
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('invalid_decimals');
      const [knownToken] = await db.select({ symbol: schema.tokens.symbol, name: schema.tokens.name }).from(schema.tokens).where(eq(schema.tokens.address, token));
      let symbol = knownToken?.symbol ?? token.slice(0, 8), name = knownToken?.name ?? symbol;
      try { if (!knownToken || /^0x/i.test(symbol)) symbol = String(decodeAbiParameters([{ type: 'string' }], await rpc<`0x${string}`>('eth_call', [{ to: token, data: '0x95d89b41' }, 'latest']))[0]).slice(0, 64); if (!knownToken) name = symbol; } catch { /* Preserve actual contract address if symbol is unavailable. */ }
      const value = { symbol, name, decimals };
      await db.insert(schema.tokens).values({ address: token, symbol, name }).onConflictDoNothing();
      await db.insert(schema.tokenProfiles).values({ address: token, decimals }).onConflictDoUpdate({ target: schema.tokenProfiles.address, set: { decimals } });
      meta.set(token, value); return value;
    }
    async function processTransaction(hash: string) {
      if (seen.has(hash)) { queue.delete(hash); return; }
      const receipt = await rpc<Receipt>('eth_getTransactionReceipt', [hash]);
      const movements = receiptMovements(receipt, wallets);
      if (movements.length) {
        const block = await rpc<{ hash: string; timestamp: string }>('eth_getBlockByNumber', [receipt.blockNumber, false]);
        if (block.hash !== receipt.blockHash) throw new Error('canonical_block_changed');
        const timestamp = new Date(Number(block.timestamp) * 1000).toISOString();
        const rows = [];
        for (const m of movements) {
          const row = normalizeMovement(m, receipt, timestamp, await metadata(m.token), quote && Date.now() - quote.at < 10 * 60_000 ? quote.price : undefined);
          if (row) rows.push(row);
        }
        if (rows.length) {
          const count = await insertTrades(db, rows); state.inserted += count;
          for (const row of rows) if (row.amountUsd !== undefined) await db.update(schema.trades).set({ amountUsd: row.amountUsd, price: row.price }).where(and(eq(schema.trades.txHash, hash), eq(schema.trades.traderId, row.wallet), eq(schema.trades.tokenAddress, row.tokenAddress), eq(schema.trades.side, row.side), isNull(schema.trades.amountUsd)));
          if (count) { if (!state.lastTradeAt || timestamp > state.lastTradeAt) { state.lastTradeAt = timestamp; state.lastLatencyMs = Date.now() - Date.parse(timestamp); } onInsert(count, timestamp); }
        }
      } else state.skipped++;
      seen.add(hash); queue.delete(hash); state.lastProgressAt = Date.now(); state.error = null; await report();
      while (seen.size > 20_000) seen.delete(seen.values().next().value!);
    }
    while (!stopped) {
      try {
        await renew();
        if (Date.now() - lastRoster > 3_600_000) {
          // Public identity discovery only. Trades and performance are reconstructed
          // independently; a discovery outage keeps the already stored roster.
          const [discovery] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'public-feed:discovery'));
          if (!Array.isArray((discovery?.value as { addresses?: string[] })?.addresses) || Date.now() - discovery!.updatedAt.getTime() > 86_400_000) {
            await put('public-feed:discovery', { ...(discovery?.value as Record<string, unknown> ?? {}), at: new Date().toISOString(), status: 'attempted' });
            try {
              const response = await fetch('https://fomopulse.app/api/traders?window=24h&limit=300', { signal: AbortSignal.timeout(10_000) });
              if (!response.ok) throw new Error('discovery_unavailable');
              const rows: unknown = await response.json();
              if (!Array.isArray(rows)) throw new Error('discovery_invalid');
              const identities = [];
              for (const raw of rows.slice(0, 350)) {
                if (!raw || typeof raw.address !== 'string' || !/^0x[0-9a-f]{40}$/i.test(raw.address) || typeof raw.handle !== 'string' || !raw.handle.trim()) continue;
                const wallet = raw.address.toLowerCase(), handle = raw.handle.slice(0, 80);
                const avatar = typeof raw.avatar_url === 'string' && raw.avatar_url.startsWith('https://prod-fomo-profile-pics.s3.amazonaws.com/') ? raw.avatar_url : null;
                identities.push({ id: wallet, wallet, handle, name: typeof raw.display_name === 'string' ? raw.display_name.slice(0, 120) : handle, avatar });
              }
              if (identities.length) await db.insert(schema.traders).values(identities).onConflictDoNothing();
              await put('public-feed:discovery', { at: new Date().toISOString(), status: 'ok', wallets: identities.length, addresses: identities.map(r => r.wallet), source: 'FomoPulse public identities; no imported PnL' });
            } catch { console.error('{"event":"public_identity_discovery_unavailable"}'); }
          }
          const [storedRoster] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'public-feed:discovery'));
          const storedAddresses = (storedRoster?.value as { addresses?: string[] })?.addresses;
          const identities = await db.select({ id: schema.traders.id }).from(schema.traders).where(like(schema.traders.avatar, 'https://prod-fomo-profile-pics.s3.amazonaws.com/%'));
          // Keep the direct subscription bounded to the Fomo roster. The existing
          // Stalkchain consumer continues covering the other tracked wallets.
          wallets = new Set((storedAddresses ?? identities.map(r => r.id)).map(w => w.toLowerCase()).filter(w => /^0x[0-9a-f]{40}$/.test(w)).slice(0, 350));
          state.tracked = wallets.size;
          lastRoster = Date.now(); if (wallets.size) connect();
        }
        if (!state.connected && Date.now() >= reconnectAt && (!socket || socket.readyState === WebSocket.CLOSED)) connect();
        if (Date.now() - lastQuote > 300_000) {
          lastQuote = Date.now();
          try {
            const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${USDG}`, { signal: AbortSignal.timeout(10_000) });
            if (!response.ok) throw new Error('quote_unavailable');
            const pairs = await response.json();
            const prices = (Array.isArray(pairs) ? pairs : []).filter(p => p.chainId === 'robinhood' && p.quoteToken?.address?.toLowerCase() === USDG && Number(p.liquidity?.usd) >= 10000).map(p => Number(p.priceUsd) / Number(p.priceNative)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
            if (prices.length >= 3) {
              const median = prices[Math.floor(prices.length / 2)];
              if (prices.filter(p => Math.abs(p / median - 1) < 0.01).length >= 3) quote = { price: median, at: Date.now() };
            }
          } catch { /* Never assume a dollar peg. */ }
        }
        for (const hash of removed) {
          await db.delete(schema.trades).where(and(eq(schema.trades.txHash, hash), like(schema.trades.id, 'public:4663:%')));
          queue.delete(hash); removed.delete(hash); onInsert(0, state.lastTradeAt ?? new Date().toISOString());
        }
        // Live arrivals take priority over bounded catch-up scans.
        for (const [hash] of [...queue].filter(([, block]) => block <= state.head - 5).sort((a, b) => b[1] - a[1]).slice(0, 20)) await processTransaction(hash);
        if (state.head && wallets.size && Date.now() >= nextScan && queue.size < 100) {
          nextScan = Date.now() + 10_000;
          if (!state.cursor) state.cursor = Math.max(1, state.head - 500);
          const end = Math.min(state.cursor + 500, state.head - 5);
          if (end > state.cursor) {
            const walletTopics = [...wallets].map(w => '0x' + w.slice(2).padStart(64, '0'));
            const hashes = new Set<string>();
            for (const topics of [[TRANSFER, walletTopics], [TRANSFER, null, walletTopics]]) {
              const logs = await rpc<Log[]>('eth_getLogs', [{ fromBlock: hex(state.cursor + 1), toBlock: hex(end), topics }]);
              for (const log of logs) { enqueue(log); if (!log.removed) hashes.add(log.transactionHash); }
            }
            for (const hash of hashes) {
              await processTransaction(hash);
              const live = [...queue].filter(([, block]) => block > end && block <= state.head - 5).sort((a, b) => b[1] - a[1]).slice(0, 2);
              for (const [liveHash] of live) await processTransaction(liveHash);
            }
            // Advance only after every receipt and insert succeeds; replay is idempotent.
            await put('public-feed:cursor', { block: end, at: new Date().toISOString() }); state.cursor = end;
          }
        }
        state.pending = queue.size; state.error = null;
        await report();
      } catch (error) {
        if (stopped) break;
        state.error = error instanceof Error && /^public_|^invalid_|^canonical_/.test(error.message) ? error.message : 'public_feed_cycle_failed';
        state.pending = queue.size;
        console.error(JSON.stringify({ event: 'public_feed_retry', reason: state.error }));
        await sleep(10_000);
      }
      await sleep(500);
    }
  }
  const done = (async () => {
    while (!stopped) {
      try { await run(); }
      catch (error) { state.error = error instanceof Error && error.message === 'public_feed_standby' ? error.message : 'public_feed_start_failed'; console.error(JSON.stringify({ event: state.error })); if (!stopped) await sleep(15_000); }
    }
  })();
  return { state, stop: async () => { stopped = true; state.connected = false; clearInterval(heartbeat); socket?.close(); await done; await release(); } };
}
