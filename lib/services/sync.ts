import "server-only";
import { after } from "next/server";
import { acquireSyncLease } from "./sync-lock";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb, dbDriver, schema, type Db } from "@/lib/db";
import { getProvider } from "@/lib/providers";
import { FLOW_WINDOWS, RANKING_PERIODS, type FlowWindow, type RankingPeriod, type UpstreamTrade, type UpstreamTraderProfile } from "@/lib/providers/types";
import { computePnl, summarizeWallets, type PnlInputTrade } from "./pnl";
import { computeScore } from "./score";
import type { Freshness } from "@/lib/types";
import { fetchMarketQuotes, marketDataEnabled } from "@/lib/providers/market-data";

const { traders, tokens, trades, traderSnapshots, tokenSnapshots, traderTokenStats, dataSourceSyncs, appMeta } = schema;

export const WINDOW_MS: Record<FlowWindow, number> = {
  "1h": 3_600_000,
  "6h": 6 * 3_600_000,
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
};

export const PERIOD_MS: Record<RankingPeriod, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  all: 365 * 24 * 3_600_000,
};

/** Freshness threshold for the LIVE indicator. */
export const LIVE_MAX_AGE_MS = 60_000;

export interface SyncResult {
  kind: "full" | "trades";
  provider: string;
  tradesUpserted: number;
  durationMs: number;
}

type SyncState = {
  inflight?: Promise<SyncResult>;
  lastRunAt: Partial<Record<"full" | "trades", number>>;
  lastSnapshotAt?: number;
  bootstrapped?: Promise<void>;
  profileRefresh?: Promise<void>;
  profileAt?: Map<string, number>;
};

const g = globalThis as unknown as { __analystSync?: SyncState };
const state: SyncState = g.__analystSync ?? (g.__analystSync = { lastRunAt: {} });

async function waitForReadRefresh(work: Promise<unknown>): Promise<void> {
  if (process.env.VERCEL) after(async () => { await work.catch(() => undefined); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, 3000); })]); }
  finally { if (timer) clearTimeout(timer); }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toHandle(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24) || "trader";
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

export async function upsertTraders(
  db: Db,
  rows: { wallet: string; name: string; handle?: string; avatar?: string; twitterUrl?: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) seen.set(r.wallet.toLowerCase(), r);
  for (const batch of chunk([...seen.values()], 200)) {
    await db
      .insert(traders)
      .values(
        batch.map((r) => ({
          id: r.wallet.toLowerCase(),
          wallet: r.wallet.toLowerCase(),
          name: r.name,
          handle: r.handle ?? toHandle(r.name),
          avatar: r.avatar ?? null,
          twitterUrl: r.twitterUrl ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: traders.id,
        set: {
          name: sql`excluded.name`,
          handle: sql`excluded.handle`,
          avatar: sql`coalesce(excluded.avatar, ${traders.avatar})`,
          twitterUrl: sql`coalesce(excluded.twitter_url, ${traders.twitterUrl})`,
          updatedAt: new Date(),
        },
      });
  }
}

async function ensureTraderStubs(db: Db, wallets: string[]): Promise<void> {
  const unique = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (unique.length === 0) return;
  for (const batch of chunk(unique, 200)) {
    await db
      .insert(traders)
      .values(batch.map((w) => ({ id: w, wallet: w, name: `${w.slice(0, 6)}…${w.slice(-4)}`, handle: w.slice(2, 10) })))
      .onConflictDoNothing();
  }
}

export async function upsertTokens(
  db: Db,
  rows: {
    address: string;
    symbol: string;
    name?: string;
    image?: string;
    price?: number;
    marketCap?: number;
    volume24h?: number;
    priceChange24h?: number;
    lastActivityAt?: string;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = r.address.toLowerCase();
    const prev = seen.get(key);
    seen.set(key, prev ? { ...prev, ...r } : r);
  }
  for (const batch of chunk([...seen.values()], 200)) {
    await db
      .insert(tokens)
      .values(
        batch.map((r) => ({
          address: r.address.toLowerCase(),
          symbol: r.symbol,
          name: r.name ?? r.symbol,
          image: r.image ?? null,
          price: r.price ?? null,
          marketCap: r.marketCap ?? null,
          volume24h: r.volume24h ?? null,
          priceChange24h: r.priceChange24h ?? null,
          lastActivityAt: r.lastActivityAt ? new Date(r.lastActivityAt) : null,
        })),
      )
      .onConflictDoUpdate({
        target: tokens.address,
        set: {
          symbol: sql`case when excluded.symbol ~* '^0x[0-9a-f]+$' then ${tokens.symbol} else excluded.symbol end`,
          name: sql`case when excluded.name = excluded.symbol then ${tokens.name} else excluded.name end`,
          image: sql`coalesce(excluded.image, ${tokens.image})`,
          price: sql`coalesce(excluded.price, ${tokens.price})`,
          marketCap: sql`coalesce(excluded.market_cap, ${tokens.marketCap})`,
          volume24h: sql`coalesce(excluded.volume_24h, ${tokens.volume24h})`,
          priceChange24h: sql`coalesce(excluded.price_change_24h, ${tokens.priceChange24h})`,
          lastActivityAt: sql`greatest(coalesce(excluded.last_activity_at, ${tokens.lastActivityAt}), coalesce(${tokens.lastActivityAt}, excluded.last_activity_at))`,
          updatedAt: new Date(),
        },
      });
  }
}

export async function insertTrades(db: Db, rows: UpstreamTrade[]): Promise<number> {
  if (rows.length === 0) return 0;
  await ensureTraderStubs(
    db,
    rows.map((r) => r.wallet),
  );
  await upsertTokens(
    db,
    rows.map((r) => ({ address: r.tokenAddress, symbol: r.tokenSymbol, name: r.tokenName, lastActivityAt: r.timestamp })),
  );
  let inserted = 0;
  // Profiles identify trades by transaction; the global feed also adds a numeric
  // ID. Reuse the stored ID across both endpoints so history is never counted twice.
  const identity = (t: { txHash?: string | null; traderId?: string; wallet?: string; tokenAddress: string; side: string }) =>
    t.txHash ? `${t.txHash.toLowerCase()}:${(t.wallet ?? t.traderId)?.toLowerCase()}:${t.tokenAddress.toLowerCase()}:${t.side}` : null;
  const existingIds = new Map<string, string>();
  const hashes = [...new Set(rows.flatMap((r) => r.txHash ? [r.txHash] : []))];
  for (const batch of chunk(hashes, 300)) {
    const stored = await db.select({ id: trades.id, txHash: trades.txHash, traderId: trades.traderId, tokenAddress: trades.tokenAddress, side: trades.side })
      .from(trades).where(inArray(trades.txHash, batch));
    for (const row of stored) { const key = identity(row); if (key) existingIds.set(key, row.id); }
  }
  const unique = new Map<string, UpstreamTrade>();
  for (const row of rows) {
    const key = identity(row);
    const id = key ? existingIds.get(key) ?? row.id : row.id;
    if (key) existingIds.set(key, id);
    unique.set(id, { ...row, id });
  }
  const ordered = [...unique.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  for (const batch of chunk(ordered, 200)) {
    const res = await db
      .insert(trades)
      .values(
        batch.map((r) => ({
          id: r.id,
          traderId: r.wallet.toLowerCase(),
          tokenAddress: r.tokenAddress.toLowerCase(),
          side: r.side,
          amountUsd: r.amountUsd ?? null,
          tokenAmount: r.tokenAmount ?? null,
          price: r.price ?? null,
          nativeAmount: r.nativeAmount ?? null,
          timestamp: new Date(r.timestamp),
          txHash: r.txHash ?? null,
          dex: r.dex ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: trades.id });
    inserted += res.length;
  }
  // last-active bookkeeping
  const lastByWallet = new Map<string, number>();
  for (const r of rows) {
    const w = r.wallet.toLowerCase();
    lastByWallet.set(w, Math.max(lastByWallet.get(w) ?? 0, Date.parse(r.timestamp)));
  }
  for (const [wallet, ts] of lastByWallet) {
    await db
      .update(traders)
      .set({ lastActiveAt: sql`greatest(coalesce(${traders.lastActiveAt}, ${new Date(ts).toISOString()}::timestamptz), ${new Date(ts).toISOString()}::timestamptz)` })
      .where(eq(traders.id, wallet));
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------

type TradeLite = {
  id: string;
  traderId: string;
  tokenAddress: string;
  side: string;
  amountUsd: number | null;
  tokenAmount: number | null;
  timestamp: Date;
  realizedPnl: number | null;
};

async function loadTrades(db: Db, sinceMs: number): Promise<TradeLite[]> {
  return db
    .select({
      id: trades.id,
      traderId: trades.traderId,
      tokenAddress: trades.tokenAddress,
      side: trades.side,
      amountUsd: trades.amountUsd,
      tokenAmount: trades.tokenAmount,
      timestamp: trades.timestamp,
      realizedPnl: trades.realizedPnl,
    })
    .from(trades)
    .where(gt(trades.timestamp, new Date(sinceMs)))
    .orderBy(trades.timestamp);
}

function toPnlInput(rows: TradeLite[]): PnlInputTrade[] {
  return rows.map((r) => ({
    id: r.id,
    wallet: r.traderId,
    tokenAddress: r.tokenAddress,
    side: r.side === "BUY" ? "BUY" : "SELL",
    amountUsd: r.amountUsd ?? 0,
    tokenAmount: r.tokenAmount,
    timestamp: r.timestamp.getTime(),
  }));
}

/** Recomputes realized PnL, trader-token stats, trader aggregates and token snapshots from trades. */
export async function recomputeDerived(db: Db, opts: { providerOwnsRankings: boolean }): Promise<void> {
  const now = Date.now();
  const all = await loadTrades(db, now - PERIOD_MS.all);
  const input = toPnlInput(all);
  const pnl = computePnl(input);

  // 1) Per-trade realized PnL where it changed.
  const updates: { id: string; realized: number }[] = [];
  for (const row of all) {
    const r = pnl.perTrade.get(row.id);
    if (r !== null && r !== undefined && (row.realizedPnl === null || Math.abs(row.realizedPnl - r) > 0.005)) {
      updates.push({ id: row.id, realized: r });
    }
  }
  for (const batch of chunk(updates, 100)) {
    await Promise.all(batch.map((u) => db.update(trades).set({ realizedPnl: u.realized }).where(eq(trades.id, u.id))));
  }

  // 2) Trader-token stats.
  const statRows = [...pnl.positions.values()].map((p) => ({
    traderId: p.wallet,
    tokenAddress: p.tokenAddress,
    firstBuyAt: p.firstBuyAt ? new Date(p.firstBuyAt) : null,
    lastBuyAt: p.lastBuyAt ? new Date(p.lastBuyAt) : null,
    lastTradeAt: p.lastTradeAt ? new Date(p.lastTradeAt) : null,
    buys: p.buys,
    sells: p.sells,
    boughtUsd: p.boughtUsd,
    soldUsd: p.soldUsd,
    realizedPnl: p.realizedPnl,
    exposureUsd: p.hasAmounts ? p.costBasis : null,
    updatedAt: new Date(),
  }));
  for (const batch of chunk(statRows, 200)) {
    await db
      .insert(traderTokenStats)
      .values(batch)
      .onConflictDoUpdate({
        target: [traderTokenStats.traderId, traderTokenStats.tokenAddress],
        set: {
          firstBuyAt: sql`excluded.first_buy_at`,
          lastBuyAt: sql`excluded.last_buy_at`,
          lastTradeAt: sql`excluded.last_trade_at`,
          buys: sql`excluded.buys`,
          sells: sql`excluded.sells`,
          boughtUsd: sql`excluded.bought_usd`,
          soldUsd: sql`excluded.sold_usd`,
          realizedPnl: sql`excluded.realized_pnl`,
          exposureUsd: sql`coalesce(excluded.exposure_usd, ${traderTokenStats.exposureUsd})`,
          updatedAt: new Date(),
        },
      });
  }

  // 3) Trader aggregates (only fill what the provider did not supply).
  const summaries = summarizeWallets(input, pnl);
  for (const s of summaries.values()) {
    await db
      .update(traders)
      .set({
        totalTrades: sql`greatest(${traders.totalTrades}, ${s.trades})`,
        buys: sql`greatest(${traders.buys}, ${s.buys})`,
        sells: sql`greatest(${traders.sells}, ${s.sells})`,
        avgTradeSize: s.avgTradeSize,
        volumeUsd: opts.providerOwnsRankings ? sql`coalesce(${traders.volumeUsd}, ${s.volumeUsd})` : s.volumeUsd,
        realizedPnl: opts.providerOwnsRankings ? sql`coalesce(${traders.realizedPnl}, ${s.realizedPnl})` : s.realizedPnl,
        winRate: opts.providerOwnsRankings ? sql`coalesce(${traders.winRate}, ${s.winRate})` : s.winRate,
        bestTradeUsd: opts.providerOwnsRankings ? sql`coalesce(${traders.bestTradeUsd}, ${s.bestTradeUsd})` : s.bestTradeUsd,
        updatedAt: new Date(),
      })
      .where(eq(traders.id, s.wallet));
  }

  // Period snapshots computed locally when the provider has no leaderboard of its own.
  if (!opts.providerOwnsRankings) {
    for (const period of RANKING_PERIODS) {
      const from = now - PERIOD_MS[period];
      const windowTrades = input.filter((t) => t.timestamp > from);
      const perWallet = [...summarizeWallets(windowTrades, pnl).values()].sort(
        (a, b) => (b.realizedPnl ?? 0) - (a.realizedPnl ?? 0),
      );
      await writeSnapshots(
        db,
        period,
        perWallet.map((s, i) => ({
          traderId: s.wallet,
          pnl: s.realizedPnl ?? 0,
          roi: s.roi,
          trades: s.trades,
          buys: s.buys,
          sells: s.sells,
          volumeUsd: s.volumeUsd,
          bestTradeUsd: s.bestTradeUsd,
          winRate: s.winRate,
          rank: i + 1,
        })),
      );
    }
  }

  await recomputeTokenSnapshots(db, all);
}

async function writeSnapshots(
  db: Db,
  period: RankingPeriod,
  rows: {
    traderId: string;
    pnl: number;
    roi: number | null;
    trades: number;
    buys: number;
    sells: number;
    volumeUsd: number | null;
    bestTradeUsd: number | null;
    winRate: number | null;
    rank: number;
  }[],
): Promise<void> {
  await db.transaction(async (tx) => {
    // A provider owns only the wallets it returned. Preserve other sources.
    if (rows.length) await tx.delete(traderSnapshots).where(and(eq(traderSnapshots.period, period), inArray(traderSnapshots.traderId, rows.map((r) => r.traderId))));
    for (const batch of chunk(rows, 200)) {
      await tx.insert(traderSnapshots).values(batch.map((r) => ({ ...r, period, computedAt: new Date() })));
    }
    await tx.execute(sql`update trader_snapshots s set rank = r.rank from (select id, row_number() over (order by pnl desc, trader_id asc)::int as rank from trader_snapshots where period = ${period}) r where s.id = r.id`);
  });
}

async function recomputeTokenSnapshots(db: Db, all: TradeLite[]): Promise<void> {
  const now = Date.now();
  const traderRows = await db
    .select({ id: traders.id, realizedPnl: traders.realizedPnl, avgTradeSize: traders.avgTradeSize })
    .from(traders);
  const ranked = [...traderRows].sort((a, b) => (b.realizedPnl ?? 0) - (a.realizedPnl ?? 0));
  const percentile = new Map<string, number>();
  ranked.forEach((t, i) => percentile.set(t.id, ranked.length > 1 ? 1 - i / (ranked.length - 1) : 1));
  const avgSize = new Map(traderRows.map((t) => [t.id, t.avgTradeSize ?? null]));

  for (const window of FLOW_WINDOWS) {
    const from = now - WINDOW_MS[window];
    const mid = now - WINDOW_MS[window] / 2;
    const inWindow = all.filter((t) => t.timestamp.getTime() > from);
    const byToken = new Map<string, TradeLite[]>();
    for (const t of inWindow) {
      const list = byToken.get(t.tokenAddress) ?? [];
      list.push(t);
      byToken.set(t.tokenAddress, list);
    }

    const prelim = [...byToken.entries()].map(([address, list]) => {
      const perTrader = new Map<string, { buyUsd: number; sellUsd: number; buys: number; sells: number }>();
      let buyUsd = 0;
      let sellUsd = 0;
      let buys = 0;
      let sells = 0;
      let recentUsd = 0;
      let totalUsd = 0;
      let qualityWeighted = 0;
      let qualityWeight = 0;
      let convictionSum = 0;
      let convictionN = 0;
      for (const t of list) {
        const usd = t.amountUsd ?? 0;
        const rec = perTrader.get(t.traderId) ?? { buyUsd: 0, sellUsd: 0, buys: 0, sells: 0 };
        totalUsd += usd;
        if (t.timestamp.getTime() > mid) recentUsd += usd;
        if (t.side === "BUY") {
          buyUsd += usd;
          buys += 1;
          rec.buyUsd += usd;
          rec.buys += 1;
          const q = percentile.get(t.traderId);
          if (q !== undefined) {
            qualityWeighted += q * Math.max(usd, 1);
            qualityWeight += Math.max(usd, 1);
          }
          const a = avgSize.get(t.traderId);
          if (a && a > 0) {
            convictionSum += usd / a;
            convictionN += 1;
          }
        } else {
          sellUsd += usd;
          sells += 1;
          rec.sellUsd += usd;
          rec.sells += 1;
        }
        perTrader.set(t.traderId, rec);
      }
      let buyers = 0;
      let sellers = 0;
      let neutral = 0;
      let repeat = 0;
      let topBuyerId: string | null = null;
      let topBuyerUsd = -1;
      for (const [traderId, rec] of perTrader) {
        const net = rec.buyUsd - rec.sellUsd;
        if (net > 0 || (rec.buys > 0 && rec.sells === 0)) buyers += 1;
        else if (net < 0 || (rec.sells > 0 && rec.buys === 0)) sellers += 1;
        else neutral += 1;
        if (rec.buys > 1) repeat += 1;
        if (rec.buyUsd > topBuyerUsd && rec.buys > 0) {
          topBuyerUsd = rec.buyUsd;
          topBuyerId = traderId;
        }
      }
      return {
        address,
        trackedTraders: perTrader.size,
        buyers,
        sellers,
        neutral,
        buys,
        sells,
        buyUsd,
        sellUsd,
        netFlowUsd: buyUsd - sellUsd,
        topBuyerId,
        buyerQuality: qualityWeight > 0 ? qualityWeighted / qualityWeight : null,
        convictionRatio: convictionN > 0 ? convictionSum / convictionN : null,
        repeatBuyerShare: buyers > 0 ? repeat / buyers : 0,
        recentShare: totalUsd > 0 ? recentUsd / totalUsd : null,
      };
    });

    const netFlowScale = prelim.reduce((m, p) => Math.max(m, Math.abs(p.netFlowUsd)), 0);
    const rows = prelim.map((p) => {
      const s = computeScore({ ...p, netFlowScale });
      return {
        tokenAddress: p.address,
        window,
        trackedTraders: p.trackedTraders,
        buyers: p.buyers,
        sellers: p.sellers,
        neutral: p.neutral,
        buys: p.buys,
        sells: p.sells,
        buyUsd: p.buyUsd,
        sellUsd: p.sellUsd,
        netFlowUsd: p.netFlowUsd,
        topBuyerId: p.topBuyerId,
        score: s.score,
        scoreQuality: s.quality,
        scoreAccumulation: s.accumulation,
        scoreBreadth: s.breadth,
        scoreConviction: s.conviction,
        scoreMomentum: s.momentum,
        computedAt: new Date(),
      };
    });

    await db.transaction(async (tx) => {
      await tx.delete(tokenSnapshots).where(eq(tokenSnapshots.window, window));
      for (const batch of chunk(rows, 200)) await tx.insert(tokenSnapshots).values(batch);
    });
  }
  state.lastSnapshotAt = now;
}

/** Price / market cap enrichment for the most recently active tokens (live mode only). */
async function enrichMarketData(db: Db, limit: number): Promise<void> {
  if (!marketDataEnabled() || getProvider().isMock) return;
  const rows = await db
    .select({ address: tokens.address })
    .from(tokens)
    .orderBy(desc(sql`coalesce(${tokens.lastActivityAt}, ${tokens.firstSeenAt})`))
    .limit(limit);
  const quotes = await fetchMarketQuotes(rows.map((r) => r.address), false);
  for (const q of quotes.values()) {
    await db
      .update(tokens)
      .set({
        price: q.price ?? sql`${tokens.price}`,
        marketCap: q.marketCap,
        fdv: q.fdv ?? sql`${tokens.fdv}`,
        volume24h: q.volume24h ?? sql`${tokens.volume24h}`,
        priceChange24h: q.priceChange24h ?? sql`${tokens.priceChange24h}`,
        name: q.name ? q.name : sql`${tokens.name}`,
        image: q.image ? q.image : sql`${tokens.image}`,
        updatedAt: new Date(),
      })
      .where(eq(tokens.address, q.address));
  }
}

/** On-demand quote for a single token page; refreshes when the stored quote is missing or older than 5 minutes. */
export async function refreshTokenMarketData(address: string): Promise<void> {
  if (!marketDataEnabled() || getProvider().isMock) return;
  try {
    const db = await getDb();
    const addr = address.toLowerCase();
    const [row] = await db.select({ address: tokens.address }).from(tokens).where(eq(tokens.address, addr)).limit(1);
    if (!row) return;
    const quotes = await fetchMarketQuotes([addr]);
    const q = quotes.get(addr);
    if (!q) return;
    await db
      .update(tokens)
      .set({
        price: q.price ?? sql`${tokens.price}`,
        marketCap: q.marketCap,
        fdv: q.fdv ?? sql`${tokens.fdv}`,
        volume24h: q.volume24h ?? sql`${tokens.volume24h}`,
        priceChange24h: q.priceChange24h ?? sql`${tokens.priceChange24h}`,
        name: q.name ? q.name : sql`${tokens.name}`,
        image: q.image ? q.image : sql`${tokens.image}`,
        updatedAt: new Date(),
      })
      .where(eq(tokens.address, addr));
  } catch (err) {
    console.error("[market-data:token]", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Sync entry points
// ---------------------------------------------------------------------------

async function latestTradeTimestamp(db: Db): Promise<string | undefined> {
  // An auxiliary history import must not advance KOLHOOD's ingestion cursor.
  const [row] = await db.select({ ts: trades.timestamp }).from(trades)
    .where(sql`${trades.id} not like 'defined:%'`).orderBy(desc(trades.timestamp)).limit(1);
  return row?.ts.toISOString();
}

async function saveProfile(db: Db, p: UpstreamTraderProfile): Promise<number> {
  const wallet = p.wallet.toLowerCase();
  await upsertTraders(db, [{ wallet, name: p.name, handle: p.handle, avatar: p.avatar, twitterUrl: p.twitterUrl }]);
  await db.update(traders).set({
    realizedPnl: p.realizedPnl,
    volumeUsd: p.volumeUsd,
    avgTradeSize: p.volumeUsd !== undefined && p.totalTrades ? p.volumeUsd / p.totalTrades : undefined,
    totalTrades: p.totalTrades,
    winRate: p.winRate,
    bestTradeUsd: p.bestTradeUsd,
    nativeBalance: p.nativeBalance,
    updatedAt: new Date(),
  }).where(eq(traders.id, wallet));
  const inserted = await insertTrades(db, p.recentTrades ?? []);
  await upsertTokens(db, p.holdings.map((h) => ({ address: h.tokenAddress, symbol: h.symbol })));
  // Clear positions which the authoritative holdings snapshot no longer lists.
  await db.update(traderTokenStats).set({ exposureUsd: 0 }).where(eq(traderTokenStats.traderId, wallet));
  for (const h of p.holdings) {
    await db.insert(traderTokenStats)
      .values({ traderId: wallet, tokenAddress: h.tokenAddress.toLowerCase(), exposureUsd: h.usdValue ?? null })
      .onConflictDoUpdate({ target: [traderTokenStats.traderId, traderTokenStats.tokenAddress], set: { exposureUsd: h.usdValue ?? null, updatedAt: new Date() } });
  }
  (state.profileAt ??= new Map()).set(wallet, Date.now());
  return inserted;
}

/** Fetch history on demand for any wallet, including those outside the leaderboard. */
export async function refreshTraderProfiles(wallets: string[]): Promise<void> {
  if (process.env.WEBHOOK_FEED_ENABLED === "1") return;
  if (process.env.VERCEL) return; // Scheduled full sync owns profile writes on multiple instances.
  if (getProvider().isMock || wallets.length === 0) return;
  if (state.inflight || state.profileRefresh) return;
  const missing = [...new Set(wallets.map((w) => w.toLowerCase()))]
    .filter((w) => /^0x[a-f0-9]{40}$/.test(w))
    .filter((w) => Date.now() - (state.profileAt?.get(w) ?? 0) > 5 * 60_000);
  if (missing.length === 0) return;
  state.profileRefresh = (async () => {
    const db = await getDb();
    let changed = false;
    for (const batch of chunk(missing, 6)) {
      const profiles = await Promise.all(batch.map((wallet) => getProvider().fetchTraderProfile(wallet).catch(() => null)));
      for (const profile of profiles) if (profile) { await saveProfile(db, profile); changed = true; }
    }
    if (changed) await recomputeDerived(db, { providerOwnsRankings: true });
  })().catch((error) => { console.error("[profile-sync]", error instanceof Error ? error.message : error); }).finally(() => { state.profileRefresh = undefined; });
  await waitForReadRefresh(state.profileRefresh);
}

export async function refreshTokenTraders(address: string): Promise<void> {
  if (getProvider().isMock) return;
  const db = await getDb();
  const rows = await db.select({ wallet: traderTokenStats.traderId }).from(traderTokenStats)
    .where(eq(traderTokenStats.tokenAddress, address.toLowerCase())).limit(16);
  await refreshTraderProfiles(rows.map((r) => r.wallet));
}

async function fullSync(db: Db): Promise<number> {
  const provider = getProvider();
  const isMock = provider.isMock;

  const upstreamTraders = await provider.fetchTraders();
  await upsertTraders(db, upstreamTraders);

  const rankingsByPeriod = await Promise.all(RANKING_PERIODS.map((p) => provider.fetchLeaderboard(p)));
  const rankedWallets = new Set<string>();
  for (const rows of rankingsByPeriod) {
    await upsertTraders(
      db,
      rows.map((r) => ({ wallet: r.wallet, name: r.name, twitterUrl: r.twitterUrl })),
    );
    for (const r of rows) rankedWallets.add(r.wallet.toLowerCase());
  }

  const after = await latestTradeTimestamp(db);
  const upstreamTrades = await provider.fetchTrades({ limit: after ? 500 : 5000, after });
  let inserted = await insertTrades(db, upstreamTrades);

  const activity = await provider.fetchTokenActivity();
  await upsertTokens(
    db,
    activity.map((a) => ({
      address: a.address,
      symbol: a.symbol,
      name: a.name,
      image: a.image,
      price: a.price,
      marketCap: a.marketCap,
      volume24h: a.volume24hUsd,
      priceChange24h: a.priceChange24h,
      lastActivityAt: a.lastActivityAt,
    })),
  );

  // Profiles: bounded fan-out so a live upstream is not hammered.
  const profileWallets = [...new Set([...upstreamTraders.map((t) => t.wallet.toLowerCase()), ...rankedWallets])].slice(
    0,
    300,
  );
  for (const batch of chunk(profileWallets, isMock ? 20 : 6)) {
    const profiles = await Promise.all(batch.map((w) => provider.fetchTraderProfile(w).catch(() => null)));
    for (const p of profiles) {
      if (!p) continue;
      inserted += await saveProfile(db, p);
    }
  }

  if (!isMock) {
    // Upstream leaderboard is authoritative for period rankings and for the headline PnL.
    const allRows = rankingsByPeriod[RANKING_PERIODS.indexOf("all")] ?? [];
    for (const r of allRows) {
      await db.update(traders).set({ realizedPnl: r.pnl }).where(eq(traders.id, r.wallet.toLowerCase()));
    }
    for (let i = 0; i < RANKING_PERIODS.length; i++) {
      const period = RANKING_PERIODS[i];
      const rows = rankingsByPeriod[i];
      await writeSnapshots(
        db,
        period,
        rows.map((r, idx) => ({
          traderId: r.wallet.toLowerCase(),
          pnl: r.pnl,
          roi: r.roi ?? null,
          trades: r.trades,
          buys: r.buys,
          sells: r.sells,
          volumeUsd: null,
          bestTradeUsd: r.bestTradeUsd ?? null,
          winRate: r.winRate ?? null,
          rank: idx + 1,
        })),
      );
    }
  }

  await recomputeDerived(db, { providerOwnsRankings: !isMock });
  await enrichMarketData(db, 5000);
  return inserted;
}

async function tradesSync(db: Db): Promise<number> {
  const provider = getProvider();
  const after = await latestTradeTimestamp(db);
  const upstreamTrades = await provider.fetchTrades({ limit: after ? 200 : 5000, after });
  const inserted = await insertTrades(db, upstreamTrades);
  const snapshotStale = !state.lastSnapshotAt || Date.now() - state.lastSnapshotAt > 60_000;
  if (inserted > 0 || snapshotStale) {
    await recomputeDerived(db, { providerOwnsRankings: !provider.isMock });
    await enrichMarketData(db, 150);
  }
  return inserted;
}

export async function runSync(kind: "full" | "trades"): Promise<SyncResult> {
  if (process.env.WEBHOOK_FEED_ENABLED === "1") return { kind, provider: process.env.LIVE_FEED_SOURCE || 'alchemy', tradesUpserted: 0, durationMs: 0 };
  if (state.profileRefresh) await state.profileRefresh;
  if (state.inflight) return state.inflight;
  const started = Date.now();
  const provider = getProvider();
  state.inflight = (async () => {
    const db = await getDb();
    const release = process.env.VERCEL ? await acquireSyncLease() : undefined;
    if (release === null) {
      return { kind, provider: provider.name, tradesUpserted: 0, durationMs: Date.now() - started };
    }
    try {
    const [log] = await db
      .insert(dataSourceSyncs)
      .values({ provider: provider.name, kind, status: "running" })
      .returning({ id: dataSourceSyncs.id });
    try {
      const inserted = kind === "full" ? await fullSync(db) : await tradesSync(db);
      try {
        const { publishSystemEvent } = await import("@/lib/social/system-events");
        await publishSystemEvent();
      } catch {
        console.error("System event generation failed; market sync continues.");
      }
      await db
        .update(dataSourceSyncs)
        .set({ status: "ok", finishedAt: new Date(), tradesUpserted: inserted })
        .where(eq(dataSourceSyncs.id, log.id));
      state.lastRunAt[kind] = Date.now();
      if (kind === "full") state.lastRunAt.trades = Date.now();
      await db
        .insert(appMeta)
        .values({ key: "lastSync", value: { at: new Date().toISOString(), ok: true, kind, provider: provider.name } })
        .onConflictDoUpdate({
          target: appMeta.key,
          set: { value: { at: new Date().toISOString(), ok: true, kind, provider: provider.name }, updatedAt: new Date() },
        });
        if (dbDriver() === "pglite") await db.execute(sql`CHECKPOINT`);
        return { kind, provider: provider.name, tradesUpserted: inserted, durationMs: Date.now() - started };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(dataSourceSyncs)
        .set({ status: "error", finishedAt: new Date(), error: message.slice(0, 1000) })
        .where(eq(dataSourceSyncs.id, log.id));
      state.lastRunAt[kind] = Date.now();
      throw err;
    }
    } finally {
      if (release) await release();
    }
  })().finally(() => { state.inflight = undefined; });
  return state.inflight;
}

/** Runs the first full sync when the database is empty. Safe to call on every request. */
export async function ensureBootstrapped(): Promise<void> {
  if (process.env.WEBHOOK_FEED_ENABLED === "1") return;
  if (process.env.VERCEL) return;
  if (!state.bootstrapped) {
    state.bootstrapped = (async () => {
      const db = await getDb();
      const [row] = await db.select({ id: traders.id }).from(traders).limit(1);
      const [lastFull] = await db
        .select({ id: dataSourceSyncs.id })
        .from(dataSourceSyncs)
        .where(and(eq(dataSourceSyncs.kind, "full"), eq(dataSourceSyncs.status, "ok")))
        .limit(1);
      if (!row || !lastFull) {
        await runSync("full");
      }
    })().catch((err) => {
      state.bootstrapped = undefined;
      throw err;
    });
  }
  return state.bootstrapped;
}

/**
 * Sync-on-read with throttling. Keeps the app alive in development and on serverless hosts
 * without a scheduler; errors are swallowed so reads never fail because upstream hiccuped.
 */
export async function ensureFresh(kind: "full" | "trades", maxAgeMs: number): Promise<void> {
  if (process.env.WEBHOOK_FEED_ENABLED === "1") return;
  if (process.env.VERCEL) return; // The external scheduler owns ingestion; reads never bootstrap a full job.
  try {
    await ensureBootstrapped();
    // Rank/profile snapshots need refreshes too; trade-only polling otherwise
    // leaves their values frozen indefinitely after the first bootstrap.
    if (kind === "trades") {
      if (state.lastRunAt.full === undefined) {
        const db = await getDb();
        const [lastFull] = await db.select({ at: dataSourceSyncs.finishedAt }).from(dataSourceSyncs)
          .where(and(eq(dataSourceSyncs.kind, "full"), eq(dataSourceSyncs.status, "ok")))
          .orderBy(desc(dataSourceSyncs.id)).limit(1);
        state.lastRunAt.full = lastFull?.at?.getTime() ?? 0;
      }
      if (Date.now() - state.lastRunAt.full > 15 * 60_000 && !state.inflight) {
        await waitForReadRefresh(runSync("full"));
        return;
      }
    }
    const last = state.lastRunAt[kind] ?? 0;
    if (Date.now() - last < maxAgeMs) return;
    if (state.inflight) return;
    await waitForReadRefresh(runSync(kind));
  } catch (err) {
    console.error(`[sync:${kind}]`, err instanceof Error ? err.message : err);
  }
}

export async function getFreshness(): Promise<Freshness> {
  if (process.env.WEBHOOK_FEED_ENABLED === "1") return (await import("../indexer/webhook-freshness")).webhookFreshness();
  const db = await getDb();
  const provider = getProvider();
  const [last] = await db
    .select({ finishedAt: dataSourceSyncs.finishedAt, status: dataSourceSyncs.status })
    .from(dataSourceSyncs)
    .where(inArray(dataSourceSyncs.status, ["ok", "error"]))
    .orderBy(desc(dataSourceSyncs.id))
    .limit(1);
  const [lastOk] = await db
    .select({ finishedAt: dataSourceSyncs.finishedAt })
    .from(dataSourceSyncs)
    .where(eq(dataSourceSyncs.status, "ok"))
    .orderBy(desc(dataSourceSyncs.id))
    .limit(1);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(traders);
  const at = lastOk?.finishedAt ?? null;
  const ageMs = at ? Date.now() - at.getTime() : null;
  const status: Freshness["status"] = ageMs === null ? "offline" : ageMs <= LIVE_MAX_AGE_MS ? "live" : "delayed";
  const [latestTrade] = await db.select({ timestamp: trades.timestamp }).from(trades).orderBy(desc(trades.timestamp)).limit(1);
  const tradeAgeMs = latestTrade ? Math.max(0, Date.now() - latestTrade.timestamp.getTime()) : null;
  return {
    checkedAt: new Date().toISOString(),
    lastTradeAt: latestTrade?.timestamp.toISOString() ?? null,
    tradeAgeMs,
    provider: provider.name,
    isMock: provider.isMock,
    lastSyncAt: at ? at.toISOString() : null,
    lastSyncOk: last?.status === "ok",
    ageMs,
    status: status === "live" && (tradeAgeMs == null || tradeAgeMs > 600000) ? "delayed" : status,
    trackedTraders: Number(count ?? 0),
  };
}
