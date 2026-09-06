import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, sql } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { computePnl, summarizeWallets, type PnlInputTrade } from "../lib/services/pnl";
import { parseLiveTrade, mergeLiveTrades, matchesTrade } from "../lib/client/live-trades";
import { normalizeDefinedImport } from "../lib/providers/defined-import";
import { executionPriceSamples } from "../lib/chart-executions";
import { analyzePerformance } from "../lib/performance";
import { groupMarkers, executionPrice } from "../lib/chart-markers";
import { emptyTracking, evaluateAlerts, matchesAlert, parseTracking, type AlertRule } from "../lib/client/tracking-model";
import { activitySignal } from "../lib/activity-signal";
import type { AnalystTrade, AnalystToken } from "../lib/types";

const trackingTrade = (overrides: Partial<AnalystTrade> = {}): AnalystTrade => ({
  id: "fixture", seq: 1, traderId: `0x${"a".repeat(40)}`,
  trader: { id: `0x${"a".repeat(40)}`, wallet: `0x${"a".repeat(40)}`, name: "Fixture", handle: "fixture" },
  token: { address: `0x${"b".repeat(40)}`, symbol: "FIX", name: "Fixture" }, side: "BUY", amountUsd: 100, tokenAmount: 10, price: 10,
  timestamp: new Date(1_000_000).toISOString(), txHash: `0x${"c".repeat(64)}`, ...overrides,
});
test("alert rules filter real events, ignore replay and merge matching rules into one notice", () => {
  const t = trackingTrade();
  const rule: AlertRule = { id: "rule", name: "Buys", scope: "following", wallet: "", side: "BUY", minUsd: 100, token: "$fix", enabled: true, armedAt: 999_000 };
  const state = { ...emptyTracking(), following: [t.trader], rules: [rule, { ...rule, id: "two", name: "Second" }] };
  const alerts = evaluateAlerts([t, { ...t, id: "stream", seq: 0 }], state, 1_000_001);
  assert.equal(alerts.length, 1); assert.deepEqual(alerts[0].ruleNames, ["Buys", "Second"]);
  assert.equal(evaluateAlerts([t], { ...state, seen: [alerts[0].id] }, 1_000_001).length, 0);
  assert.equal(matchesAlert(t, rule, [], 1_000_001), false);
  assert.equal(matchesAlert({ ...t, amountUsd: null }, rule, state.following, 1_000_001), false);
  assert.equal(matchesAlert({ ...t, side: "SELL" }, rule, state.following, 1_000_001), false);
  assert.equal(matchesAlert(t, { ...rule, armedAt: 1_000_002 }, state.following, 1_000_001), false);
  assert.equal(matchesAlert(t, rule, state.following, 2_000_001), false);
  assert.equal(matchesAlert(t, { ...rule, enabled: false }, state.following, 1_000_001), false);
  assert.equal(matchesAlert(t, { ...rule, scope: "wallet", wallet: `0x${"d".repeat(40)}` }, state.following, 1_000_001), false);
  assert.deepEqual(parseTracking("broken"), emptyTracking());
  assert.equal(parseTracking(JSON.stringify(state)).rules.length, 2);
});
test("performance uses weighted prices and holding time; partial and missing quantities stay explicit", () => {
  const row = { tokenAddress: "token", symbol: "FIX", side: "BUY", amountUsd: 100, tokenAmount: 10, timestamp: new Date(0) };
  const [p] = analyzePerformance([row, { ...row, amountUsd: 300, timestamp: new Date(3_600_000) }, { ...row, side: "SELL", tokenAmount: 30, amountUsd: 900, timestamp: new Date(7_200_000) }]);
  assert.equal(p.averageEntry, 20); assert.equal(p.averageExit, 30);
  assert.equal(p.realizedPnl, 200); assert.equal(p.holdingMs, 5_400_000);
  assert.equal(p.recordedOpenQuantity, 0); assert.equal(p.uncoveredSells, 1);
  const [missing] = analyzePerformance([row, { ...row, tokenAmount: null }, { ...row, side: "SELL", timestamp: new Date(1000) }]);
  assert.equal(missing.averageEntry, null); assert.equal(missing.recordedOpenQuantity, null);
  assert.equal(missing.realizedPnl, null); assert.equal(missing.holdingMs, null); assert.equal(missing.priced, 2);
});
test("chart grouping retains actual execution coordinates and never makes up missing prices", () => {
  const t = trackingTrade();
  assert.equal(executionPrice({ ...t, price: null, tokenAmount: null }), null);
  assert.equal(executionPrice({ ...t, price: null }), 10);
  const groups = groupMarkers([t, { ...t, id: "second", timestamp: new Date(1_000_100).toISOString() }, { ...t, side: "SELL" }], 999_000, 1_100_000);
  assert.equal(groups.length, 2); assert.equal(groups[0].trades.length, 2); assert.equal(groups[0].t, 1_000_100);
  assert.equal(groupMarkers([t], 1_000_001, 2_000_000).length, 0);
});
test("green activity signal requires every criterion and expires with stale activity", () => {
  const token = { lastActivityAt: new Date(1_000_000).toISOString(), buyers: 5, sellers: 1, buyUsd: 2000, sellUsd: 500, netAccumulation: 1500, price: 1, score: { score: 80 } } as AnalystToken;
  assert.equal(activitySignal(token, 1_000_001).green, true);
  assert.equal(activitySignal(token, 2_000_000).green, false);
  assert.equal(activitySignal({ ...token, price: null }, 1_000_001).green, false);
  assert.equal(activitySignal({ ...token, buyers: 2 }, 1_000_001).green, false);
});

test("execution chart fallback uses only historical prices or exact trade quantities without fabricated OHLC", () => {
  const t = new Date("2026-09-06T12:00:00Z");
  const samples = executionPriceSamples([
    { t, price: 0.5, usd: 100 },
    { t, price: null, usd: 60, tokenAmount: 100 },
    { t, price: null, usd: 50 },
    { t, price: Infinity, usd: 30 },
  ]);
  assert.deepEqual(samples.map((p) => p.close), [0.5, 0.6]);
  assert.ok(samples.every((p) => p.open === undefined && p.high === undefined && p.low === undefined));
});

test("Defined import validates chain, resolves quote token and deduplicates logs before grouping transactions", () => {
  const wallet = `0x${"b".repeat(40)}`;
  const token = `0x${"c".repeat(40)}`;
  const envelope = { capturedAt: "2026-09-06T12:00:00Z", networkId: 4663, rows: [{ address: wallet, networkId: 4663, wallet: { displayName: "Fixture", avatarUrl: null, twitterUsername: null } }] };
  const event = { networkId: 4663, maker: wallet, transactionHash: `0x${"d".repeat(64)}`, logIndex: 1, timestamp: 1788696000, eventDisplayType: "Buy", quoteToken: "token1", token0Address: wallet, token1Address: token, data: { amountNonLiquidityToken: "2", priceUsd: "10", priceUsdTotal: "20" } };
  const records = [{ operation: "Tokens", data: { tokens: [{ address: token, networkId: 4663, symbol: "FIXTURE", name: "Fixture" }] } }, { operation: "GetTokenEventsForMaker", data: { getTokenEventsForMaker: { items: [event, event, { ...event, logIndex: 2 }, { ...event, logIndex: 3, networkId: 56 }, { ...event, logIndex: 4, maker: token }, { ...event, logIndex: 5, data: { ...event.data, priceUsdTotal: "Infinity" } }] } } }];
  const result = normalizeDefinedImport(envelope, [{ wallet, records }]);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].tokenAddress, token);
  assert.equal(result.trades[0].amountUsd, 40);
  assert.equal(result.trades[0].tokenAmount, 4);
  assert.equal(result.trades[0].price, 10);
  assert.equal(result.skipped, 1);
  assert.throws(() => normalizeDefinedImport({ ...envelope, networkId: 56 }, []));
});

test("stream events reconcile with persisted IDs, preserve cursor and reject invalid source values", () => {
  const event = { tx_hash: `0x${"a".repeat(64)}`, wallet_address: `0x${"b".repeat(40)}`, action: "buy", token_address: `0x${"c".repeat(40)}`, token_symbol: "TEST", usd_value: 120, timestamp: "2026-09-06T12:00:00Z" };
  const live = parseLiveTrade(event);
  assert.ok(live);
  assert.equal(live.seq, 0);
  assert.equal(live.price, null);
  const stored = { ...live, id: "kh-123", seq: 456, trader: { ...live.trader, name: "Source name", avatar: "https://example.org/source.png" } };
  const merged = mergeLiveTrades([live], [stored, live], 60);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "kh-123");
  assert.equal(merged[0].seq, 456);
  assert.equal(merged[0].trader.avatar, stored.trader.avatar);
  assert.equal(matchesTrade(live, { filter: "sells" }, new Map()), false);
  assert.equal(matchesTrade(live, { filter: "buys", q: "$test", minUsd: "100" }, new Map()), true);
  assert.equal(matchesTrade(live, { minUsd: "500" }, new Map()), false);
  assert.equal(parseLiveTrade({ ...event, timestamp: "invalid" }), null);
  assert.equal(parseLiveTrade({ ...event, tx_hash: "bad" }), null);
  assert.equal(parseLiveTrade({ ...event, usd_value: null })?.amountUsd, null);
});

const client = new PGlite();
const db = drizzle(client, { schema });
let castVote: typeof import("../lib/social/posts").castVote;

before(async () => {
  process.env.DATA_PROVIDER = "kolhood";
  process.env.MARKET_DATA_PROVIDER = "none";
  await migrate(db, { migrationsFolder: "drizzle" });
  // An isolated in-memory database: these tests never open the user's database.
  Object.assign(globalThis, { __analystDb: { db } });
  ({ castVote } = await import("../lib/social/posts"));
  await db.insert(schema.guests).values({ id: "test-guest", tokenHash: "test-hash", displayName: "Test guest" });
});
after(async () => { await client.close(); });

test("sync lease excludes overlapping jobs and a stale owner cannot release its replacement", async () => {
  const { acquireSyncLease } = await import("../lib/services/sync-lock");
  const release = await acquireSyncLease();
  assert.ok(release);
  assert.equal(await acquireSyncLease(), null);
  await db.update(schema.appMeta).set({ updatedAt: new Date(Date.now() - 7 * 60_000) }).where(eq(schema.appMeta.key, "lock:ingestion"));
  const replacement = await acquireSyncLease();
  assert.ok(replacement);
  await release();
  assert.equal(await acquireSyncLease(), null);
  await replacement();
  const fresh = await acquireSyncLease();
  assert.ok(fresh);
  await fresh();
});

test("upstream credentials never reach the public quote service; late and tied trades survive replay", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.UPSTREAM_API_KEY;
  process.env.UPSTREAM_API_KEY = "test-only-key";
  const requests: { url: URL; authorization: string | null }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    const trade = { wallet_address: "0xabc", action: "buy", token_address: "0xdef", usd_value: 10 };
    const body = url.hostname === "api.coingecko.com" ? { ethereum: { usd: 2000 } }
      : url.pathname === "/api/tokens/trending" ? { data: [] }
      : { data: [
        { ...trade, id: "tied", timestamp: "2026-09-06T10:00:00Z" },
        { ...trade, id: "late", timestamp: "2026-09-06T09:59:30Z" },
        { ...trade, id: "new", timestamp: "2026-09-06T10:00:01Z" },
      ] };
    return new Response(JSON.stringify(body));
  };
  try {
    const { kolhoodProvider } = await import("../lib/providers/kolhood");
    await kolhoodProvider.fetchTokenActivity();
    assert.equal(requests.find((r) => r.url.hostname === "api.coingecko.com")?.authorization, null);
    assert.equal(requests.find((r) => r.url.pathname === "/api/tokens/trending")?.authorization, "Bearer test-only-key");
    const trades = await kolhoodProvider.fetchTrades({ limit: 200, after: "2026-09-06T10:00:00Z" });
    assert.deepEqual(trades.map((t) => t.id), ["kh-tied", "kh-late", "kh-new"]);
    assert.equal(requests.at(-1)?.url.searchParams.get("limit"), "500");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.UPSTREAM_API_KEY;
    else process.env.UPSTREAM_API_KEY = originalKey;
  }
});

const history: PnlInputTrade[] = [
  { id: "b1", wallet: "w", tokenAddress: "t", side: "BUY", amountUsd: 100, tokenAmount: 10, timestamp: 1 },
  { id: "s1", wallet: "w", tokenAddress: "t", side: "SELL", amountUsd: 200, tokenAmount: 10, timestamp: 2 },
  { id: "b2", wallet: "w", tokenAddress: "t", side: "BUY", amountUsd: 100, tokenAmount: 10, timestamp: 3 },
  { id: "s2", wallet: "w", tokenAddress: "t", side: "SELL", amountUsd: 50, tokenAmount: 10, timestamp: 4 },
];

test("a losing period does not inherit earlier wins or earlier invested capital", () => {
  const summary = summarizeWallets(history.slice(2), computePnl(history)).get("w");
  assert.equal(summary?.realizedPnl, -50);
  assert.equal(summary?.winRate, 0);
  assert.equal(summary?.roi, -50);
});

test("sell-only periods retain the historical cost basis without including historical wins", () => {
  const summary = summarizeWallets(history.slice(3), computePnl(history)).get("w");
  assert.equal(summary?.roi, -50);
  assert.equal(summary?.winRate, 0);
});

test("partial positions use only covered cost basis; unknown positions stay unavailable", () => {
  const rows: PnlInputTrade[] = [history[0], { ...history[1], tokenAmount: 20, amountUsd: 400 }];
  assert.equal(summarizeWallets(rows, computePnl(rows)).get("w")?.roi, 100);
  const unknown = [history[1]];
  const summary = summarizeWallets(unknown, computePnl(unknown)).get("w");
  assert.equal(summary?.realizedPnl, null);
  assert.equal(summary?.winRate, null);
  assert.equal(summary?.roi, null);
});

test("simultaneous first votes, reversals, and removals keep one vote and consistent counters", async () => {
  await db.insert(schema.posts).values({ id: "test-post", guestId: "test-guest", body: "Test", bodyHash: "test" });
  for (const value of [1, -1, 0] as const) {
    await Promise.all(Array.from({ length: 8 }, () => castVote("test-guest", "post", "test-post", value)));
    const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, "test-post"));
    const votes = await db.select().from(schema.votes).where(eq(schema.votes.targetId, "test-post"));
    assert.equal(post.upvotes, value === 1 ? 1 : 0);
    assert.equal(post.downvotes, value === -1 ? 1 : 0);
    assert.equal(votes.length, value === 0 ? 0 : 1);
    if (value !== 0) assert.equal(votes[0].value, value);
  }
});

test("a failed counter update rolls back the vote insert", async () => {
  await db.execute(sql`CREATE FUNCTION reject_test_counter() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$ LANGUAGE plpgsql`);
  await db.execute(sql`CREATE TRIGGER test_counter BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION reject_test_counter()`);
  try {
    await assert.rejects(castVote("test-guest", "post", "test-post", 1));
    const rows = await db.select().from(schema.votes).where(eq(schema.votes.targetId, "test-post"));
    assert.equal(rows.length, 0);
  } finally {
    await db.execute(sql`DROP TRIGGER test_counter ON posts`);
    await db.execute(sql`DROP FUNCTION reject_test_counter()`);
  }
});

test("profile history fills token activity without duplicating global-feed transactions or listing holdings as zero trades", async () => {
  const fetchBefore = globalThis.fetch;
  const wallet = "0x" + "a".repeat(40);
  const token = "0x" + "b".repeat(40);
  const heldOnly = "0x" + "c".repeat(40);
  const timestamp = new Date().toISOString();
  const buy = { tx_hash: "0x" + "1".repeat(64), action: "buy", token_address: token, token_symbol: "QA", usd_value: 100, timestamp };
  const sell = { ...buy, tx_hash: "0x" + "2".repeat(64), action: "sell", usd_value: 125 };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    let body: unknown;
    if (url.pathname === "/api/wallets/list") body = [{ address: wallet, name: "History trader", local_avatar: "/avatars/history.png" }];
    else if (url.pathname === "/api/trades") body = { data: [{ ...buy, id: 42, wallet_address: wallet }] };
    else if (url.pathname.endsWith("/profile")) body = {
      kol: { address: wallet, name: "History trader", local_avatar: "/avatars/history.png" },
      summary: { total_trades: 2, total_volume_usd: 225, realized_pnl_usd: 25, win_rate: 100 },
      holdings: [{ token_address: heldOnly, token_symbol: "HELD", usd_value: 123 }],
      recent_trades: [buy, sell],
    };
    else if (url.pathname === "/api/leaderboard") body = { data: [{ wallet_address: wallet, wallet_name: "History trader", total_pnl_usd: 25, total_trades: 2, buy_count: 1, sell_count: 1 }] };
    else if (url.pathname === "/api/tokens/trending") body = { data: [] };
    else body = { ethereum: { usd: 2000 } };
    return new Response(JSON.stringify(body));
  };
  try {
    const { runSync } = await import("../lib/services/sync");
    const { getTokenTopTraders, getTrader } = await import("../lib/services/intelligence");
    await runSync("full");
    await runSync("full");
    const trades = await db.select().from(schema.trades).where(eq(schema.trades.traderId, wallet));
    assert.equal(trades.length, 2);
    const [active] = await getTokenTopTraders(token);
    assert.equal(active.buys, 1);
    assert.equal(active.sells, 1);
    assert.equal(active.boughtUsd, 100);
    assert.equal(active.soldUsd, 125);
    assert.equal(active.lastTradeAt, timestamp);
    assert.deepEqual(await getTokenTopTraders(heldOnly), []);
    const trader = await getTrader(wallet);
    assert.equal(trader?.lastActive, timestamp);
    assert.equal(trader?.trades, 2);
    assert.equal(trader?.winRate, 100);
    assert.equal(trader?.avatar, "https://kolhood.io/avatars/history.png");
  } finally { globalThis.fetch = fetchBefore; }
});

test("chart metadata is reused across bulk and individual requests, with candles for the requested token", async () => {
  const original = globalThis.fetch;
  const address = "0x" + "c".repeat(40);
  const requests: URL[] = [];
  const now = Math.floor(Date.now() / 1000);
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)); requests.push(url);
    const body = url.pathname.includes("ohlcv")
      ? { data: { attributes: { ohlcv_list: [[now, 2, 3, 1, 2.5, 10], [now - 3600, 1, 2, 1, 2, 5]] } } }
      : { data: [{ attributes: { address, name: "Chart token", symbol: "CHART", image_url: "https://example.org/token.png", price_usd: "2.5", market_cap_usd: null, fdv_usd: "2500", total_reserve_in_usd: "100", volume_usd: { h24: "15" } }, relationships: { top_pools: { data: [{ id: "robinhood_pool-address" }] } } }] };
    return new Response(JSON.stringify(body));
  };
  try {
    const { fetchGeckoTokens, fetchTokenCandles } = await import("../lib/providers/geckoterminal");
    await fetchGeckoTokens([address]);
    const chart = await fetchTokenCandles(address, "24h");
    assert.equal(requests.length, 2);
    assert.equal(requests[1].searchParams.get("token"), address);
    assert.equal(chart.candles.length, 2);
    assert.ok(chart.candles[0].t < chart.candles[1].t);
    assert.equal(chart.token?.marketCap, null);
    assert.equal(chart.token?.fdv, 2500);
    await fetchTokenCandles(address, "24h");
    assert.equal(requests.length, 2);
  } finally { globalThis.fetch = original; }
});

test("launchpad charts preserve real quote units and reject a different contract", async () => {
  const original = globalThis.fetch;
  const address = "0x" + "d".repeat(40);
  globalThis.fetch = async () => new Response(JSON.stringify({ token: address, quoteSymbol: "AAPL", quoteUsd: 320, points: [{ t: Math.floor(Date.now()/1000), price: 0.000001, volumeQuote: 4 }] }));
  try {
    const { fetchLaunchpadChart } = await import("../lib/providers/launchpad");
    const result = await fetchLaunchpadChart(address, "24h");
    assert.equal(result?.unit, "AAPL");
    assert.equal(result?.candles[0].close, 0.000001);
    assert.equal(await fetchLaunchpadChart("0x" + "e".repeat(40), "24h"), null);
  } finally { globalThis.fetch = original; }
});

test("live community reads exclude seeded posts and ratings", async () => {
  await db.insert(schema.guests).values({ id: "seed-verification", displayName: "Seed", tokenHash: "seed-verification", isSeed: true });
  await db.insert(schema.posts).values({ id: "seed-verification-post", guestId: "seed-verification", body: "Seeded market observation", bodyHash: "seed-verification-post" });
  await db.insert(schema.ratings).values({ id: "seed-verification-rating", guestId: "seed-verification", targetType: "token", targetId: "seed-token", score: 10 });
  const { listPosts, getPost } = await import("../lib/social/posts");
  const { getRatingSummary } = await import("../lib/social/ratings");
  assert.equal((await listPosts({ guestId: null })).some(p => p.id === "seed-verification-post"), false);
  assert.equal(await getPost("seed-verification-post", null), null);
  assert.equal((await getRatingSummary("token", "seed-token", null)).count, 0);
});


test("Defined replay is idempotent and never invents all-time rankings or replaces an existing identity", async () => {
  const wallet = '0x' + 'e'.repeat(40);
  const envelope = { capturedAt: '2026-09-06T12:00:00Z', networkId: 4663, rows: [{ address: wallet, networkId: 4663, realizedProfitUsd30d: '50', swaps30d: 3, realizedProfitUsd1y: '999', wallet: { displayName: 'Imported fixture', avatarUrl: null, twitterUsername: null } }] };
  const { importDefinedSnapshot } = await import('../lib/services/defined-import');
  const first = await importDefinedSnapshot(envelope, []);
  assert.equal(first.added, 1);
  const replay = await importDefinedSnapshot(envelope, []);
  assert.equal(replay.added, 0);
  const snapshots = await db.select().from(schema.traderSnapshots).where(eq(schema.traderSnapshots.traderId, wallet));
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].period, '30d');
  assert.equal(snapshots[0].pnl, 50);
  const { listTraders } = await import('../lib/services/intelligence');
  const found = await listTraders({ query: 'Imported fixture', period: '30d' });
  assert.equal(found.length, 1);
  assert.equal(found[0].statsSource, 'Defined');
  assert.equal(found[0].buys, null);
  await db.update(schema.traders).set({ name: 'Preferred identity' }).where(eq(schema.traders.id, wallet));
  await importDefinedSnapshot(envelope, []);
  const [identity] = await db.select().from(schema.traders).where(eq(schema.traders.id, wallet));
  assert.equal(identity.name, 'Preferred identity');
});
