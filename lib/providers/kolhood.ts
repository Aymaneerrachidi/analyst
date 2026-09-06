/**
 * KOLHOOD DATA PROVIDER
 *
 * Wraps the public JSON routes that kolhood.io's own frontend calls (observed on 2026-09-06,
 * served with `Access-Control-Allow-Origin: *`, no authentication):
 *
 *   GET /api/trades?limit=N
 *   GET /api/wallets/list
 *   GET /api/wallets/:address/profile
 *   GET /api/leaderboard?period=24h|7d|30d|all
 *   GET /api/tokens/trending
 *
 * Only these observed routes are used. Everything is validated with zod and normalized into the
 * provider contract. Token prices / market caps are not exposed upstream and are left undefined.
 * `kol_net_inflow` is denominated in ETH and converted with a cached public CoinGecko quote.
 */
import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import type {
  DataProvider,
  FetchTradesOptions,
  RankingPeriod,
  UpstreamRankingRow,
  UpstreamTokenActivity,
  UpstreamTrade,
  UpstreamTrader,
  UpstreamTraderProfile,
} from "./types";

const num = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
});
const optNum = num.nullish().transform((v) => (v === null || v === undefined ? undefined : v));

const tradeSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  tx_hash: z.string().nullish(),
  wallet_address: z.string(),
  action: z.string(),
  token_address: z.string(),
  token_symbol: z.string().nullish(),
  token_name: z.string().nullish(),
  eth_amount: optNum,
  token_amount: optNum,
  usd_value: optNum,
  dex: z.string().nullish(),
  timestamp: z.string(),
});

const tradesResponse = z.object({ data: z.array(tradeSchema) });

const walletSchema = z.object({
  address: z.string(),
  name: z.string().nullish(),
  twitter: z.string().nullish(),
  local_avatar: z.string().nullish(),
  pnl_24h: optNum,
});

const walletsResponse = z.array(walletSchema);

const leaderboardRow = z.object({
  wallet_address: z.string(),
  wallet_name: z.string().nullish(),
  wallet_twitter: z.string().nullish(),
  total_pnl_usd: optNum,
  total_trades: optNum,
  buy_count: optNum,
  sell_count: optNum,
  best_trade_usd: optNum,
});

const leaderboardResponse = z.object({ data: z.array(leaderboardRow) });

const profileResponse = z.object({
  kol: z.object({
    address: z.string(),
    name: z.string().nullish(),
    twitter: z.string().nullish(),
    local_avatar: z.string().nullish(),
  }),
  native_balance: optNum,
  summary: z
    .object({
      realized_pnl_usd: optNum,
      total_volume_usd: optNum,
      total_trades: optNum,
      win_rate: optNum,
      top_win_usd: optNum,
    })
    .nullish(),
  holdings: z
    .array(
      z.object({
        token_symbol: z.string().nullish(),
        token_address: z.string(),
        usd_value: optNum,
      }),
    )
    .nullish(),
  recent_trades: z.array(tradeSchema.omit({ wallet_address: true })).nullish(),
});

const trendingToken = z.object({
  token_address: z.string(),
  token_symbol: z.string().nullish(),
  latest_activity: z.string().nullish(),
  kol_count: optNum,
  kol_net_inflow: optNum,
  volume_24h: optNum,
});

const trendingResponse = z.object({ data: z.array(trendingToken) });

const coingeckoResponse = z.object({ ethereum: z.object({ usd: z.number() }) });

async function getJson(url: string): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json" };
  const key = env().UPSTREAM_API_KEY;
  // This helper also fetches public quotes. Credentials belong only to our upstream.
  if (key && new URL(url).origin === new URL(env().UPSTREAM_BASE_URL).origin) {
    headers.authorization = `Bearer ${key}`;
  }
  const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
  return res.json();
}

function upstream(pathname: string): string {
  return new URL(pathname, env().UPSTREAM_BASE_URL).toString();
}

function handleFromTwitter(twitter: string | null | undefined, fallback: string): string {
  if (!twitter) return fallback;
  const m = twitter.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/);
  return m ? m[1].toLowerCase() : fallback;
}

function avatarUrl(local: string | null | undefined): string | undefined {
  if (!local) return undefined;
  return local.startsWith("http") ? local : upstream(local);
}

function traderAvatar(local: string | null | undefined, twitter: string | null | undefined): string | undefined {
  if (local) return avatarUrl(local);
  const handle = handleFromTwitter(twitter, "");
  return handle ? `https://unavatar.io/twitter/${encodeURIComponent(handle)}?fallback=false` : undefined;
}

let ethQuote: { price: number; at: number } | null = null;

async function ethUsd(): Promise<number | null> {
  if (ethQuote && Date.now() - ethQuote.at < 5 * 60_000) return ethQuote.price;
  try {
    const raw = await getJson("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    const parsed = coingeckoResponse.parse(raw);
    ethQuote = { price: parsed.ethereum.usd, at: Date.now() };
    return ethQuote.price;
  } catch {
    return ethQuote?.price ?? null;
  }
}

function normalizeTrade(raw: z.infer<typeof tradeSchema>): UpstreamTrade | null {
  const side = raw.action.toLowerCase();
  if (side !== "buy" && side !== "sell") return null;
  const id = raw.id !== undefined ? `kh-${raw.id}` : raw.tx_hash ? `kh-${raw.tx_hash}:${raw.wallet_address.toLowerCase()}:${raw.token_address.toLowerCase()}:${side}` : null;
  if (!id) return null;
  return {
    id,
    txHash: raw.tx_hash ?? undefined,
    wallet: raw.wallet_address.toLowerCase(),
    side: side === "buy" ? "BUY" : "SELL",
    tokenAddress: raw.token_address.toLowerCase(),
    tokenSymbol: raw.token_symbol || "UNKNOWN",
    tokenName: raw.token_name && raw.token_name !== "Token" ? raw.token_name : undefined,
    amountUsd: raw.usd_value,
    tokenAmount: raw.token_amount && raw.token_amount > 0 ? raw.token_amount : undefined,
    nativeAmount: raw.eth_amount,
    dex: raw.dex ?? undefined,
    timestamp: new Date(raw.timestamp).toISOString(),
  };
}

export const kolhoodProvider: DataProvider = {
  name: "kolhood",
  isMock: false,

  async fetchTraders(): Promise<UpstreamTrader[]> {
    const parsed = walletsResponse.parse(await getJson(upstream("/api/wallets/list")));
    return parsed.map((w) => ({
      wallet: w.address.toLowerCase(),
      name: w.name || w.address.slice(0, 8),
      handle: handleFromTwitter(w.twitter, (w.name || w.address.slice(2, 10)).toLowerCase()),
      avatar: traderAvatar(w.local_avatar, w.twitter),
      twitterUrl: w.twitter ?? undefined,
      pnl24h: w.pnl_24h,
    }));
  },

  async fetchLeaderboard(period: RankingPeriod): Promise<UpstreamRankingRow[]> {
    const parsed = leaderboardResponse.parse(await getJson(upstream(`/api/leaderboard?period=${period}`)));
    return parsed.data.map((r) => ({
      wallet: r.wallet_address.toLowerCase(),
      name: r.wallet_name || r.wallet_address.slice(0, 8),
      twitterUrl: r.wallet_twitter ?? undefined,
      pnl: r.total_pnl_usd ?? 0,
      trades: Math.round(r.total_trades ?? 0),
      buys: Math.round(r.buy_count ?? 0),
      sells: Math.round(r.sell_count ?? 0),
      bestTradeUsd: r.best_trade_usd,
    }));
  },

  async fetchTrades(opts: FetchTradesOptions): Promise<UpstreamTrade[]> {
    // The public endpoint has no reliable cursor. Replay its recent window and let
    // the database deduplicate by trade ID, including late arrivals and timestamp ties.
    const limit = opts.after ? 500 : Math.min(Math.max(opts.limit, 1), 500);
    const parsed = tradesResponse.parse(await getJson(upstream(`/api/trades?limit=${limit}`)));
    const out: UpstreamTrade[] = [];
    for (const raw of parsed.data) {
      const t = normalizeTrade(raw);
      if (!t) continue;
      out.push(t);
    }
    return out;
  },

  async fetchTraderProfile(wallet: string): Promise<UpstreamTraderProfile | null> {
    let raw: unknown;
    try {
      raw = await getJson(upstream(`/api/wallets/${wallet.toLowerCase()}/profile`));
    } catch {
      return null;
    }
    const parsed = profileResponse.safeParse(raw);
    if (!parsed.success) return null;
    const p = parsed.data;
    return {
      wallet: p.kol.address.toLowerCase(),
      name: p.kol.name || p.kol.address.slice(0, 8),
      avatar: traderAvatar(p.kol.local_avatar, p.kol.twitter),
      handle: handleFromTwitter(p.kol.twitter, p.kol.name ?? p.kol.address.slice(2, 10)),
      twitterUrl: p.kol.twitter ?? undefined,
      recentTrades: (p.recent_trades ?? []).flatMap((raw) => {
        const trade = normalizeTrade({ ...raw, wallet_address: p.kol.address });
        return trade ? [trade] : [];
      }),
      realizedPnl: p.summary?.realized_pnl_usd,
      volumeUsd: p.summary?.total_volume_usd,
      totalTrades: p.summary?.total_trades !== undefined ? Math.round(p.summary.total_trades) : undefined,
      winRate: p.summary?.win_rate,
      bestTradeUsd: p.summary?.top_win_usd,
      nativeBalance: p.native_balance,
      holdings: (p.holdings ?? []).map((h) => ({
        tokenAddress: h.token_address.toLowerCase(),
        symbol: h.token_symbol || "?",
        usdValue: h.usd_value,
      })),
    };
  },

  async fetchTokenActivity(): Promise<UpstreamTokenActivity[]> {
    const parsed = trendingResponse.parse(await getJson(upstream("/api/tokens/trending")));
    const eth = await ethUsd();
    return parsed.data.map((t) => ({
      address: t.token_address.toLowerCase(),
      symbol: t.token_symbol || "UNKNOWN",
      lastActivityAt: t.latest_activity ? new Date(t.latest_activity).toISOString() : undefined,
      kolCount: t.kol_count !== undefined ? Math.round(t.kol_count) : undefined,
      netInflowUsd: eth !== null && t.kol_net_inflow !== undefined ? t.kol_net_inflow * eth : undefined,
      volume24hUsd: t.volume_24h,
    }));
  },
};
