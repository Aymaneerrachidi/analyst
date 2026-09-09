import "server-only";
import { indexedTradeSnapshot } from "@/lib/intelligence/live";
import { mergeLiveTrades } from "@/lib/client/live-trades";
import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import type {
  AnalystToken,
  AnalystTokenRef,
  AnalystTrade,
  AnalystTrader,
  AnalystTraderRef,
  FlowWindow,
  PnlPoint,
  RankingPeriod,
  TraderTokenPosition,
} from "@/lib/types";
import { PERIOD_MS, WINDOW_MS } from "./sync";
import { getRatingAggregates } from "@/lib/social/ratings";
import { fetchMarketQuotes } from "@/lib/providers/market-data";
import { getProvider } from "@/lib/providers";
import { cachedLaunchpadToken } from "@/lib/providers/launchpad";
import { cleanSymbol, assetCategory, STABLE_SYMBOLS, STOCK_SYMBOLS, MEME_SYMBOLS, type AssetCategory } from "@/lib/presentation";

const { traders, tokens, trades, traderSnapshots, tokenSnapshots, traderTokenStats } = schema;

export type TradeFilter = "all" | "buys" | "sells" | "large" | "top";
export type TraderFilter = "all" | "memecoins" | "volume" | "active" | "winrate";
export type TokenTab = "trending" | "accumulating" | "distributing" | "traded" | "new";

export const LARGE_TRADE_USD = 5_000;

function traderRef(row: {
  id: string;
  name: string;
  handle: string;
  wallet: string;
  avatar: string | null;
}): AnalystTraderRef {
  return { id: row.id, name: row.name, handle: row.handle, wallet: row.wallet, avatar: row.avatar };
}

function tokenRef(row: { address: string; symbol: string; name: string; image: string | null }): AnalystTokenRef {
  return { address: row.address, symbol: cleanSymbol(row.symbol), name: row.name, image: row.image };
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

export interface ListTradesOptions {
  limit?: number;
  afterSeq?: number;
  beforeSeq?: number;
  filter?: TradeFilter;
  minUsd?: number;
  traderId?: string;
  traderIds?: string[];
  tokenAddress?: string;
  query?: string;
}

export async function listTrades(opts: ListTradesOptions = {}): Promise<AnalystTrade[]> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where: SQL[] = [];
  if (opts.afterSeq !== undefined) where.push(gt(trades.seq, opts.afterSeq));
  if (opts.beforeSeq !== undefined) where.push(lt(trades.seq, opts.beforeSeq));
  if (opts.filter === "buys") where.push(eq(trades.side, "BUY"));
  if (opts.filter === "sells") where.push(eq(trades.side, "SELL"));
  if (opts.filter === "large") where.push(gte(trades.amountUsd, LARGE_TRADE_USD));
  if (opts.minUsd && opts.minUsd > 0) where.push(gte(trades.amountUsd, opts.minUsd));
  if (opts.traderIds) where.push(inArray(trades.traderId, opts.traderIds.map(id => id.toLowerCase())));
  if (opts.traderId) where.push(eq(trades.traderId, opts.traderId.toLowerCase()));
  if (opts.tokenAddress) where.push(eq(trades.tokenAddress, opts.tokenAddress.toLowerCase()));
  if (opts.query) {
    const q = `%${opts.query.replace(/^\$/, "")}%`;
    where.push(or(ilike(tokens.symbol, q), ilike(tokens.name, q), ilike(tokens.address, q)) as SQL);
  }
  if (opts.filter === "top") {
    const top = db
      .select({ id: traderSnapshots.traderId })
      .from(traderSnapshots)
      .where(and(eq(traderSnapshots.period, "7d"), sql`${traderSnapshots.rank} <= 10`));
    where.push(inArray(trades.traderId, top));
  }

  const rows = await db
    .select({
      trade: trades,
      trader: { id: traders.id, name: traders.name, handle: traders.handle, wallet: traders.wallet, avatar: traders.avatar },
      token: { address: tokens.address, symbol: tokens.symbol, name: tokens.name, image: tokens.image },
    })
    .from(trades)
    .innerJoin(traders, eq(trades.traderId, traders.id))
    .innerJoin(tokens, eq(trades.tokenAddress, tokens.address))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(trades.timestamp), desc(trades.seq))
    .limit(limit);

  const imported: AnalystTrade[] = rows.map(({ trade, trader, token }) => ({
    id: trade.id,
    seq: Number(trade.seq),
    traderId: trade.traderId,
    trader: traderRef(trader),
    token: tokenRef(token),
    side: trade.side === "BUY" ? "BUY" : "SELL",
    amountUsd: trade.amountUsd,
    tokenAmount: trade.tokenAmount,
    price: trade.price,
    realizedPnl: trade.realizedPnl,
    timestamp: trade.timestamp.toISOString(),
    txHash: trade.txHash,
  }));
  if (opts.beforeSeq != null) return imported;
  let wallets = opts.traderId ? [opts.traderId.toLowerCase()] : opts.traderIds?.map(id => id.toLowerCase());
  if (opts.filter === 'top') {
    const ranked = await db.select({ id: traderSnapshots.traderId }).from(traderSnapshots).where(and(eq(traderSnapshots.period, '7d'), sql`${traderSnapshots.rank} <= 10`));
    const top = new Set(ranked.map(r => r.id));
    wallets = wallets ? wallets.filter(id => top.has(id)) : [...top];
  }
  // Legacy sequence numbers do not identify chain logs. Reconcile the latest
  // canonical fills on incremental polls; clients deduplicate by transaction/log.
  const indexed = await indexedTradeSnapshot(limit, { token: opts.tokenAddress, wallets, side: opts.filter === 'buys' ? 'BUY' : opts.filter === 'sells' ? 'SELL' : undefined, minUsd: Math.max(opts.minUsd ?? 0, opts.filter === 'large' ? LARGE_TRADE_USD : 0), query: opts.query?.replace(/^\$/, '') });
  return mergeLiveTrades(imported, indexed, limit);
}

// ---------------------------------------------------------------------------
// Traders
// ---------------------------------------------------------------------------

async function topTokensForTraders(ids: string[]): Promise<Map<string, AnalystTokenRef>> {
  const out = new Map<string, AnalystTokenRef>();
  if (ids.length === 0) return out;
  const db = await getDb();
  const rows = await db
    .select({
      traderId: traderTokenStats.traderId,
      boughtUsd: traderTokenStats.boughtUsd,
      realizedPnl: traderTokenStats.realizedPnl,
      token: { address: tokens.address, symbol: tokens.symbol, name: tokens.name, image: tokens.image },
    })
    .from(traderTokenStats)
    .innerJoin(tokens, eq(traderTokenStats.tokenAddress, tokens.address))
    .where(inArray(traderTokenStats.traderId, ids))
    .orderBy(desc(sql`coalesce(${traderTokenStats.realizedPnl}, 0) * 1.0 + ${traderTokenStats.boughtUsd} * 0.01`));
  for (const r of rows) {
    if (!out.has(r.traderId)) out.set(r.traderId, tokenRef(r.token));
  }
  return out;
}

export interface ListTradersOptions {
  offset?: number;
  period?: RankingPeriod;
  filter?: TraderFilter;
  limit?: number;
  query?: string;
}

export async function listTraders(opts: ListTradersOptions = {}): Promise<AnalystTrader[]> {
  const db = await getDb();
  const period = opts.period ?? "30d";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const filter = opts.filter ?? "all";

  let order: SQL;
  switch (filter) {
    case "volume":
      order = desc(sql`${traderSnapshots.volumeUsd}`);
      break;
    case "active":
      order = desc(traderSnapshots.trades);
      break;
    case "winrate":
      order = desc(sql`${traderSnapshots.winRate}`);
      break;
    default:
      order = desc(traderSnapshots.pnl);
  }

  const rows = await db
    .select({ trader: traders, snap: traderSnapshots })
    .from(traderSnapshots)
    .innerJoin(traders, eq(traderSnapshots.traderId, traders.id))
    .where(and(eq(traderSnapshots.period, period), filter === "memecoins" ? sql`exists (select 1 from trader_token_stats tt where tt.trader_id = ${traders.id})` : undefined, filter === "winrate" ? gte(traderSnapshots.trades, 5) : undefined,
      opts.query ? or(ilike(traders.name, `%${opts.query}%`), ilike(traders.handle, `%${opts.query}%`), ilike(traders.wallet, `%${opts.query}%`)) : undefined))
    .orderBy(sql`${order} nulls last`, asc(traders.id))
    .limit(limit).offset(Math.max(0, Math.floor(opts.offset ?? 0)));

  const ids = rows.map((r) => r.trader.id);
  const sourceRows = ids.length ? await db.select().from(schema.appMeta).where(inArray(schema.appMeta.key, ids.map((id) => `defined:wallet:${id}`))) : [];
  const sources = new Map(sourceRows.map((s) => [s.key.replace("defined:wallet:", ""), s]));
  const [topTokens, ratings] = await Promise.all([topTokensForTraders(ids), getRatingAggregates("trader", ids)]);

  const list = rows.map(({ trader, snap }, i) => ({
    ...traderRef(trader),
    twitterUrl: trader.twitterUrl,
    realizedPnl: snap.pnl,
    roi: snap.roi,
    winRate: snap.winRate,
    trades: snap.trades,
    buys: sources.get(trader.id)?.updatedAt.getTime() === snap.computedAt.getTime() ? null : snap.buys,
    sells: sources.get(trader.id)?.updatedAt.getTime() === snap.computedAt.getTime() ? null : snap.sells,
    avgTradeSize: snap.volumeUsd != null && snap.trades > 0 ? snap.volumeUsd / snap.trades : null,
    volumeUsd: snap.volumeUsd,
    bestTradeUsd: snap.bestTradeUsd,
    lastActive: trader.lastActiveAt?.toISOString() ?? null,
    topToken: topTokens.get(trader.id) ?? null,
    rank: filter === "all" ? (snap.rank ?? i + 1 + (opts.offset ?? 0)) : i + 1 + (opts.offset ?? 0),
    statsSource: sources.get(trader.id)?.updatedAt.getTime() === snap.computedAt.getTime() ? "Defined" as const : getProvider().isMock ? "Analyst tracked" as const : "KOLHOOD" as const,
    statsPeriod: period,
    statsUpdatedAt: snap.computedAt.toISOString(),
    communityRating: ratings.get(trader.id)?.average ?? null,
    ratingCount: ratings.get(trader.id)?.count ?? 0,
  }));

  if (filter === "memecoins") {
    // Compatibility filter key: only wallets with recorded token history.
    return list.filter((t) => t.topToken !== null);
  }
  return list;
}

export async function getTrader(id: string, period: RankingPeriod = "30d"): Promise<AnalystTrader | null> {
  const db = await getDb();
  const [row] = await db.select().from(traders).where(eq(traders.id, id.toLowerCase())).limit(1);
  if (!row) return null;
  const snaps = await db.select().from(traderSnapshots).where(eq(traderSnapshots.traderId, row.id));
  const byPeriod = new Map(snaps.map((s) => [s.period as RankingPeriod, s]));
  const [topTokens, ratings] = await Promise.all([topTokensForTraders([row.id]), getRatingAggregates("trader", [row.id])]);
  const [source] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, `defined:wallet:${row.id}`));
  const selected = byPeriod.get(period);
  const defined = Boolean(source && selected && source.updatedAt.getTime() === selected.computedAt.getTime());
  return {
    ...traderRef(row),
    twitterUrl: row.twitterUrl,
    pnl24h: byPeriod.get("24h")?.pnl ?? null,
    pnl7d: byPeriod.get("7d")?.pnl ?? null,
    pnl30d: byPeriod.get("30d")?.pnl ?? null,
    realizedPnl: selected?.pnl ?? null,
    statsSource: defined ? "Defined" : getProvider().isMock ? "Analyst tracked" : "KOLHOOD",
    statsPeriod: period,
    statsUpdatedAt: selected?.computedAt.toISOString(),
    roi: selected?.roi ?? null,
    winRate: selected?.winRate ?? null,
    trades: selected?.trades ?? null,
    buys: defined ? null : selected?.buys ?? null,
    sells: defined ? null : selected?.sells ?? null,
    avgTradeSize: selected?.volumeUsd != null && selected.trades > 0 ? selected.volumeUsd / selected.trades : null,
    volumeUsd: selected?.volumeUsd ?? null,
    bestTradeUsd: selected?.bestTradeUsd ?? null,
    lastActive: row.lastActiveAt?.toISOString() ?? null,
    topToken: topTokens.get(row.id) ?? null,
    rank: selected?.rank ?? null,
    communityRating: ratings.get(row.id)?.average ?? null,
    ratingCount: ratings.get(row.id)?.count ?? 0,
  };
}

export async function getTraderRanks(id: string): Promise<Partial<Record<RankingPeriod, number>>> {
  const db = await getDb();
  const snaps = await db
    .select({ period: traderSnapshots.period, rank: traderSnapshots.rank })
    .from(traderSnapshots)
    .where(eq(traderSnapshots.traderId, id.toLowerCase()));
  const out: Partial<Record<RankingPeriod, number>> = {};
  for (const s of snaps) if (s.rank) out[s.period as RankingPeriod] = s.rank;
  return out;
}

export async function getTraderPositions(id: string, limit = 12): Promise<TraderTokenPosition[]> {
  const db = await getDb();
  const rows = await db
    .select({ stat: traderTokenStats, token: { address: tokens.address, symbol: tokens.symbol, name: tokens.name, image: tokens.image } })
    .from(traderTokenStats)
    .innerJoin(tokens, eq(traderTokenStats.tokenAddress, tokens.address))
    .where(eq(traderTokenStats.traderId, id.toLowerCase()))
    .orderBy(sql`${traderTokenStats.lastTradeAt} desc nulls last`, desc(traderTokenStats.exposureUsd))
    .limit(limit);
  return rows.map(({ stat, token }) => ({
    token: tokenRef(token),
    firstBuyAt: stat.firstBuyAt?.toISOString() ?? null,
    lastBuyAt: stat.lastBuyAt?.toISOString() ?? null,
    lastTradeAt: stat.lastTradeAt?.toISOString() ?? null,
    buys: stat.buys,
    sells: stat.sells,
    boughtUsd: stat.boughtUsd,
    soldUsd: stat.soldUsd,
    realizedPnl: stat.realizedPnl,
    exposureUsd: stat.exposureUsd,
  }));
}

/** Cumulative realized PnL series over a period, bucketed to keep charts light. */
export async function getTraderPnlSeries(id: string, period: RankingPeriod): Promise<PnlPoint[]> {
  const db = await getDb();
  const from = new Date(Date.now() - PERIOD_MS[period]);
  const rows = await db
    .select({ ts: trades.timestamp, realized: trades.realizedPnl })
    .from(trades)
    .where(and(eq(trades.traderId, id.toLowerCase()), gt(trades.timestamp, from), eq(trades.side, "SELL"), sql`${trades.realizedPnl} is not null`))
    .orderBy(trades.timestamp);
  if (rows.length === 0) return [];
  const buckets = period === "24h" ? 48 : period === "7d" ? 84 : 60;
  const span = PERIOD_MS[period];
  const step = span / buckets;
  const start = from.getTime();
  const series: PnlPoint[] = [];
  let acc = 0;
  let idx = 0;
  for (let b = 0; b < buckets; b++) {
    const end = start + step * (b + 1);
    while (idx < rows.length && rows[idx].ts.getTime() <= end) {
      acc += rows[idx].realized ?? 0;
      idx++;
    }
    if (idx > 0) series.push({ t: new Date(end).toISOString(), value: Math.round(acc * 100) / 100 });
  }
  return series;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export interface ListTokensOptions {
  category?: AssetCategory;
  offset?: number;
  window?: FlowWindow;
  tab?: TokenTab;
  limit?: number;
  query?: string;
}

const topBuyer = alias(traders, "top_buyer");

export async function listTokens(opts: ListTokensOptions = {}): Promise<AnalystToken[]> {
  const db = await getDb();
  const window = opts.window ?? "24h";
  const tab = opts.tab ?? "trending";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  let order: SQL[];
  switch (tab) {
    case "accumulating":
      order = [desc(tokenSnapshots.netFlowUsd), desc(tokenSnapshots.score)];
      break;
    case "distributing":
      order = [asc(tokenSnapshots.netFlowUsd), desc(tokenSnapshots.sells)];
      break;
    case "traded":
      order = [desc(sql`${tokenSnapshots.buys} + ${tokenSnapshots.sells}`), desc(tokenSnapshots.buyUsd)];
      break;
    case "new":
      order = [desc(tokens.lastActivityAt)];
      break;
    default:
      order = [desc(sql`${tokenSnapshots.score} * 1.0 + least(${tokenSnapshots.trackedTraders}, 20) * 1.5`), desc(tokenSnapshots.netFlowUsd)];
  }

  const where: SQL[] = [];
  const normalizedSymbol = sql`upper(ltrim(${tokens.symbol}, '$'))`;
  const categorySql = sql`case when ${normalizedSymbol} in (${sql.join(STABLE_SYMBOLS.map(s => sql`${s}`), sql`,`)}) then 'stablecoins' when ${normalizedSymbol} in (${sql.join(STOCK_SYMBOLS.map(s => sql`${s}`), sql`,`)}) then 'stocks' when ${normalizedSymbol} in (${sql.join(MEME_SYMBOLS.map(s => sql`${s}`), sql`,`)}) then 'memes' else 'other' end`;
  if (opts.category && !["all", "new"].includes(opts.category)) where.push(sql`${categorySql} = ${opts.category}`);
  if (opts.category === "new") where.push(gt(tokens.firstSeenAt, new Date(Date.now() - 86_400_000)));
  if (tab === "distributing") where.push(lt(tokenSnapshots.netFlowUsd, 0));
  if (tab === "accumulating") where.push(gt(tokenSnapshots.netFlowUsd, 0));
  if (opts.query) {
    const q = `%${opts.query.replace(/^\$/, "")}%`;
    where.push(or(ilike(tokens.symbol, q), ilike(tokens.name, q), ilike(tokens.address, q)) as SQL);
  }

  const rows = await db
    .select({
      token: tokens,
      snap: tokenSnapshots,
      buyer: { id: topBuyer.id, name: topBuyer.name, handle: topBuyer.handle, wallet: topBuyer.wallet, avatar: topBuyer.avatar },
    })
    .from(tokens)
    .leftJoin(tokenSnapshots, and(eq(tokenSnapshots.tokenAddress, tokens.address), eq(tokenSnapshots.window, window)))
    .leftJoin(topBuyer, eq(tokenSnapshots.topBuyerId, topBuyer.id))
    .where(and(...where))
    .orderBy(...order.map(term => sql`${term} nulls last`), desc(tokens.lastActivityAt), asc(tokens.address))
    .limit(limit)
    .offset(Math.max(0, opts.offset ?? 0));

  const ratings = await getRatingAggregates(
    "token",
    rows.map((r) => r.token.address),
  );
  const published = getProvider().isMock ? [] : await Promise.all(rows.map((r) => cachedLaunchpadToken(r.token.address)));
  for (const [index, entry] of published.entries()) {
    if (!entry) continue;
    const row = rows[index].token;
    row.image ||= entry.token.image ?? null;
    row.price ??= entry.token.price;
    row.fdv ??= entry.token.fdv;
  }
  const enrichment = getProvider().isMock || process.env.INDEXER_URL && process.env.ANALYST_WORKER !== '1' ? Promise.resolve(new Map()) : fetchMarketQuotes(rows.map((r) => r.token.address)).then(async (quotes) => {
    for (const { token } of rows) {
      const quote = quotes.get(token.address);
      if (quote) await db.update(tokens).set({ image: quote.image || sql`${tokens.image}`, price: quote.price ?? sql`${tokens.price}`, fdv: quote.fdv ?? sql`${tokens.fdv}`, marketCap: quote.marketCap ?? sql`${tokens.marketCap}`, volume24h: quote.volume24h ?? sql`${tokens.volume24h}`, priceChange24h: quote.priceChange24h ?? sql`${tokens.priceChange24h}` }).where(eq(tokens.address, token.address));
    }
    return quotes;
  }).catch(() => new Map());
  if (process.env.VERCEL) { const { after } = await import("next/server"); after(async () => { await enrichment; }); }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const quotes = await Promise.race([enrichment, new Promise<Map<string, import("@/lib/providers/market-data").MarketQuote>>((resolve) => { timer = setTimeout(() => resolve(new Map()), 4000); })]).finally(() => { if (timer) clearTimeout(timer); });
  return rows.map(({ token, snap, buyer }) => {
    const quote = quotes.get(token.address);
    const enriched = quote ? { ...token, price: quote.price ?? token.price, marketCap: quote.marketCap, fdv: quote.fdv ?? token.fdv, volume24h: quote.volume24h ?? token.volume24h, priceChange24h: quote.priceChange24h ?? token.priceChange24h, image: quote.image || token.image, name: quote.name || token.name } : token;
    return mapToken(enriched, snap, buyer, window, ratings.get(token.address));
  });
}

function mapToken(
  token: typeof tokens.$inferSelect,
  snap: typeof tokenSnapshots.$inferSelect | null,
  buyer: { id: string; name: string; handle: string; wallet: string; avatar: string | null } | null,
  window: FlowWindow,
  rating?: { average: number | null; count: number },
): AnalystToken {
  return {
    hasWindowActivity: Boolean(snap),
    ...tokenRef(token),
    category: assetCategory(token.symbol),
    price: token.price,
    marketCap: token.marketCap,
    fdv: token.fdv,
    volume24h: token.volume24h,
    priceChange24h: token.priceChange24h,
    lastActivityAt: token.lastActivityAt?.toISOString() ?? null,
    window,
    trackedTraders: snap?.trackedTraders ?? 0,
    traderBuys: snap?.buys ?? 0,
    traderSells: snap?.sells ?? 0,
    buyers: snap?.buyers ?? 0,
    sellers: snap?.sellers ?? 0,
    neutral: snap?.neutral ?? 0,
    buyUsd: snap?.buyUsd ?? 0,
    sellUsd: snap?.sellUsd ?? 0,
    netAccumulation: snap?.netFlowUsd ?? 0,
    topBuyer: buyer && buyer.id ? traderRef(buyer) : null,
    score: {
      score: snap?.score ?? 0,
      quality: snap?.scoreQuality ?? 0,
      accumulation: snap?.scoreAccumulation ?? 0,
      breadth: snap?.scoreBreadth ?? 0,
      conviction: snap?.scoreConviction ?? 0,
      momentum: snap?.scoreMomentum ?? 0,
    },
    communityRating: rating?.average ?? null,
    ratingCount: rating?.count ?? 0,
  };
}

export async function getToken(address: string, window: FlowWindow = "24h"): Promise<AnalystToken | null> {
  const db = await getDb();
  const addr = address.toLowerCase();
  const [token] = await db.select().from(tokens).where(eq(tokens.address, addr)).limit(1);
  if (!token) return null;
  const [snapRow] = await db
    .select({
      snap: tokenSnapshots,
      buyer: { id: topBuyer.id, name: topBuyer.name, handle: topBuyer.handle, wallet: topBuyer.wallet, avatar: topBuyer.avatar },
    })
    .from(tokenSnapshots)
    .leftJoin(topBuyer, eq(tokenSnapshots.topBuyerId, topBuyer.id))
    .where(and(eq(tokenSnapshots.tokenAddress, addr), eq(tokenSnapshots.window, window)))
    .limit(1);
  const ratings = await getRatingAggregates("token", [addr]);
  return mapToken(token, snapRow?.snap ?? null, snapRow?.buyer ?? null, window, ratings.get(addr));
}

export interface TokenTraderRow {
  trader: AnalystTraderRef;
  realizedPnl: number | null;
  boughtUsd: number;
  soldUsd: number;
  buys: number;
  sells: number;
  lastTradeAt: string | null;
  exposureUsd: number | null;
}

export async function getTokenTopTraders(address: string, limit = 8): Promise<TokenTraderRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      stat: traderTokenStats,
      trader: { id: traders.id, name: traders.name, handle: traders.handle, wallet: traders.wallet, avatar: traders.avatar },
    })
    .from(traderTokenStats)
    .innerJoin(traders, eq(traderTokenStats.traderId, traders.id))
    .where(and(eq(traderTokenStats.tokenAddress, address.toLowerCase()), gt(sql`${traderTokenStats.buys} + ${traderTokenStats.sells}`, 0)))
    .orderBy(desc(sql`coalesce(${traderTokenStats.realizedPnl}, ${traderTokenStats.soldUsd} - ${traderTokenStats.boughtUsd})`), desc(traderTokenStats.boughtUsd))
    .limit(limit);
  return rows.map(({ stat, trader }) => ({
    trader: traderRef(trader),
    realizedPnl: stat.realizedPnl,
    boughtUsd: stat.boughtUsd,
    soldUsd: stat.soldUsd,
    buys: stat.buys,
    sells: stat.sells,
    lastTradeAt: stat.lastTradeAt?.toISOString() ?? null,
    exposureUsd: stat.exposureUsd,
  }));
}

// ---------------------------------------------------------------------------
// Search + stats
// ---------------------------------------------------------------------------

export interface SearchResult {
  tokens: (AnalystTokenRef & { price: number | null; priceChange24h: number | null })[];
  traders: (AnalystTraderRef & { realizedPnl: number | null })[];
}

export async function search(query: string, limit = 6): Promise<SearchResult> {
  const q = query.trim().replace(/^[$@]/, "");
  if (!q) return { tokens: [], traders: [] };
  const db = await getDb();
  const like = `%${q}%`;
  const prefix = `${q}%`;
  const [tokenRows, traderRows] = await Promise.all([
    db
      .select({ address: tokens.address, symbol: tokens.symbol, name: tokens.name, image: tokens.image, price: tokens.price, priceChange24h: tokens.priceChange24h })
      .from(tokens)
      .where(or(ilike(tokens.symbol, like), ilike(tokens.name, like), ilike(tokens.address, like)))
      .orderBy(sql`case when ${tokens.symbol} ilike ${prefix} then 0 else 1 end`, desc(tokens.lastActivityAt))
      .limit(limit),
    db
      .select({ id: traders.id, name: traders.name, handle: traders.handle, wallet: traders.wallet, avatar: traders.avatar, realizedPnl: traders.realizedPnl })
      .from(traders)
      .where(or(ilike(traders.name, like), ilike(traders.handle, like), ilike(traders.wallet, like)))
      .orderBy(sql`case when ${traders.name} ilike ${prefix} or ${traders.handle} ilike ${prefix} then 0 else 1 end`, desc(traders.realizedPnl))
      .limit(limit),
  ]);
  return { tokens: tokenRows, traders: traderRows };
}

export interface OverviewStats {
  trackedTraders: number;
  trades24h: number;
  buyUsd24h: number;
  tokensActive24h: number;
}

export async function getOverviewStats(): Promise<OverviewStats> {
  const db = await getDb();
  const since = new Date(Date.now() - WINDOW_MS["24h"]);
  const [[t], [tr]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(traders),
    db
      .select({
        count: sql<number>`count(*)::int`,
        buyUsd: sql<number>`coalesce(sum(case when ${trades.side} = 'BUY' then ${trades.amountUsd} else 0 end), 0)::float`,
        tokensActive: sql<number>`count(distinct ${trades.tokenAddress})::int`,
      })
      .from(trades)
      .where(gt(trades.timestamp, since)),
  ]);
  return {
    trackedTraders: Number(t?.count ?? 0),
    trades24h: Number(tr?.count ?? 0),
    buyUsd24h: Number(tr?.buyUsd ?? 0),
    tokensActive24h: Number(tr?.tokensActive ?? 0),
  };
}

/** Resolves `$SYMBOL` and `@handle` references for the social layer. */
export async function resolveRefs(symbols: string[], handles: string[]): Promise<{ tokens: Map<string, AnalystTokenRef>; traders: Map<string, AnalystTraderRef> }> {
  const db = await getDb();
  const out = { tokens: new Map<string, AnalystTokenRef>(), traders: new Map<string, AnalystTraderRef>() };
  const symSet = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const handleSet = [...new Set(handles.map((h) => h.toLowerCase()))];
  if (symSet.length) {
    const rows = await db
      .select({ address: tokens.address, symbol: tokens.symbol, name: tokens.name, image: tokens.image })
      .from(tokens)
      .where(inArray(sql`upper(${tokens.symbol})`, symSet))
      .orderBy(desc(tokens.lastActivityAt));
    for (const r of rows) if (!out.tokens.has(r.symbol.toUpperCase())) out.tokens.set(r.symbol.toUpperCase(), tokenRef(r));
  }
  if (handleSet.length) {
    const rows = await db
      .select({ id: traders.id, name: traders.name, handle: traders.handle, wallet: traders.wallet, avatar: traders.avatar })
      .from(traders)
      .where(or(inArray(sql`lower(${traders.handle})`, handleSet), inArray(sql`lower(${traders.name})`, handleSet)));
    for (const r of rows) {
      out.traders.set(r.handle.toLowerCase(), traderRef(r));
      out.traders.set(r.name.toLowerCase(), traderRef(r));
    }
  }
  return out;
}
