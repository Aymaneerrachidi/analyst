/**
 * MOCK DATA PROVIDER — synthetic, deterministic development data.
 *
 * Nothing here is real market activity. The provider reports `isMock: true`, the UI shows a
 * "mock data" badge, and ids are prefixed with `mock-` so rows can never be mistaken for
 * upstream data. Generation is a pure function of absolute time buckets, so restarts never
 * produce duplicate or conflicting trades.
 */
import type {
  DataProvider,
  FetchTradesOptions,
  RankingPeriod,
  Side,
  UpstreamRankingRow,
  UpstreamTokenActivity,
  UpstreamTrade,
  UpstreamTrader,
  UpstreamTraderProfile,
} from "./types";
import { computePnl, summarizeWallets, type PnlInputTrade } from "@/lib/services/pnl";

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hex(rand: () => number, len: number): string {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(rand() * 16)];
  return out;
}

function poisson(rand: () => number, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand();
  } while (p > L);
  return k - 1;
}

function pickWeighted<T>(rand: () => number, items: T[], weight: (item: T) => number): T {
  const weights = items.map(weight);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ---------------------------------------------------------------------------
// Static universe
// ---------------------------------------------------------------------------

interface MockTrader {
  wallet: string;
  name: string;
  handle: string;
  skill: number; // 0..1, biases token selection toward trending tokens
  activity: number; // relative trade frequency
  typicalSize: number; // USD
  favorites: number[]; // token indices
}

interface MockToken {
  address: string;
  symbol: string;
  name: string;
  basePrice: number;
  supply: number;
  drift: number; // daily log drift
  vol: number; // amplitude of the deterministic wave
  phases: number[];
  freqs: number[];
  popularity: number;
}

const TRADER_NAMES = [
  "River", "Gyro", "Ben", "Mara", "Otto", "Nova", "Kestrel", "Juno", "Pax", "Sable",
  "Wren", "Idris", "Lumen", "Cass", "Rook", "Vega", "Tamsin", "Ezra", "Halo", "Mirren",
];

const TOKEN_DEFS: { symbol: string; name: string; basePrice: number; supply: number }[] = [
  { symbol: "PONS", name: "Pons", basePrice: 0.0042, supply: 1_000_000_000 },
  { symbol: "HOODCAT", name: "Hoodcat", basePrice: 0.0000042, supply: 1_000_000_000_000 },
  { symbol: "MONEY", name: "Money", basePrice: 0.031, supply: 100_000_000 },
  { symbol: "RBC", name: "Robin Coin", basePrice: 0.0089, supply: 500_000_000 },
  { symbol: "FEATHER", name: "Feather", basePrice: 0.00062, supply: 10_000_000_000 },
  { symbol: "NEST", name: "Nest Protocol", basePrice: 0.19, supply: 21_000_000 },
  { symbol: "GREENLINE", name: "Greenline", basePrice: 0.0017, supply: 1_000_000_000 },
  { symbol: "MOONHOOD", name: "Moonhood", basePrice: 0.000091, supply: 100_000_000_000 },
  { symbol: "ARBOR", name: "Arbor", basePrice: 0.052, supply: 100_000_000 },
  { symbol: "PIXEL", name: "Pixel", basePrice: 0.0038, supply: 1_000_000_000 },
  { symbol: "ORBIT", name: "Orbit", basePrice: 0.0116, supply: 420_000_000 },
  { symbol: "SPARROW", name: "Sparrow", basePrice: 0.00028, supply: 10_000_000_000 },
  { symbol: "CANDLE", name: "Candle", basePrice: 0.0071, supply: 1_000_000_000 },
  { symbol: "LEDGER", name: "Ledger Dog", basePrice: 0.00045, supply: 10_000_000_000 },
  { symbol: "TAPE", name: "Tape", basePrice: 0.024, supply: 200_000_000 },
  { symbol: "GLIDE", name: "Glide", basePrice: 0.0013, supply: 1_000_000_000 },
  { symbol: "WICK", name: "Wick", basePrice: 0.0059, supply: 1_000_000_000 },
  { symbol: "BASIS", name: "Basis", basePrice: 0.14, supply: 50_000_000 },
  { symbol: "NIMBUS", name: "Nimbus", basePrice: 0.00082, supply: 10_000_000_000 },
  { symbol: "QUILL", name: "Quill", basePrice: 0.0022, supply: 1_000_000_000 },
  { symbol: "ROOST", name: "Roost", basePrice: 0.0107, supply: 300_000_000 },
  { symbol: "TALON", name: "Talon", basePrice: 0.0049, supply: 1_000_000_000 },
  { symbol: "SIGNAL", name: "Signal", basePrice: 0.061, supply: 100_000_000 },
  { symbol: "DRIFT", name: "Drift", basePrice: 0.00033, supply: 10_000_000_000 },
  { symbol: "MERIDIAN", name: "Meridian", basePrice: 0.27, supply: 20_000_000 },
  { symbol: "PLUME", name: "Plume", basePrice: 0.0015, supply: 1_000_000_000 },
  { symbol: "HALO", name: "Halo Cat", basePrice: 0.000067, supply: 100_000_000_000 },
  { symbol: "BEAK", name: "Beak", basePrice: 0.0092, supply: 500_000_000 },
  { symbol: "VANTAGE", name: "Vantage", basePrice: 0.083, supply: 60_000_000 },
  { symbol: "EMBER", name: "Ember", basePrice: 0.0028, supply: 1_000_000_000 },
];

const UNIVERSE_SEED = 20260906;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const HISTORY_BUCKET_MS = 10 * 60_000; // 10 minutes
const HISTORY_LAMBDA = 0.16; // ≈ 700 trades / 30 days
const LIVE_BUCKET_MS = 30_000; // 30 seconds
const LIVE_LAMBDA = 0.55; // ≈ one trade per minute
const LIVE_HORIZON_MS = 2 * HOUR;
const HISTORY_DAYS = 30;

function buildUniverse(): { traders: MockTrader[]; tokens: MockToken[] } {
  const rand = mulberry32(UNIVERSE_SEED);
  const tokens: MockToken[] = TOKEN_DEFS.map((def) => {
    const phases = [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2];
    const freqs = [0.4 + rand() * 0.8, 1.5 + rand() * 2.5, 5 + rand() * 9];
    return {
      address: `0x${hex(rand, 40)}`,
      symbol: def.symbol,
      name: def.name,
      basePrice: def.basePrice,
      supply: def.supply,
      drift: (rand() - 0.42) * 0.09,
      vol: 0.08 + rand() * 0.22,
      phases,
      freqs,
      popularity: 0.3 + rand() * 1.7,
    };
  });

  const traders: MockTrader[] = TRADER_NAMES.map((name) => {
    const favorites = new Set<number>();
    const favCount = 3 + Math.floor(rand() * 5);
    while (favorites.size < favCount) favorites.add(Math.floor(rand() * tokens.length));
    return {
      wallet: `0x${hex(rand, 40)}`,
      name,
      handle: name.toLowerCase(),
      skill: rand(),
      activity: 0.4 + rand() * 1.6,
      typicalSize: Math.exp(6.2 + rand() * 2.6), // ~$500 – $6.5K
      favorites: [...favorites],
    };
  });

  return { traders, tokens };
}

const universe = buildUniverse();
const tokenByAddress = new Map(universe.tokens.map((t) => [t.address, t]));
const traderByWallet = new Map(universe.traders.map((t) => [t.wallet, t]));

/** Deterministic, continuous price path (log-space drift plus layered waves). */
function priceAt(token: MockToken, at: number): number {
  const days = (at - Date.UTC(2026, 0, 1)) / DAY;
  let wave = 0;
  for (let i = 0; i < token.phases.length; i++) {
    wave += Math.sin(days * token.freqs[i] + token.phases[i]) / (i + 1);
  }
  const trend = Math.sin(days / 9 + token.phases[0]) * 0.35;
  return token.basePrice * Math.exp(token.drift * (days % 60) * 0.3 + wave * token.vol + trend);
}

// ---------------------------------------------------------------------------
// Trade generation (pure function of absolute time)
// ---------------------------------------------------------------------------

function generateBucket(kind: "h" | "l", bucketIndex: number, bucketMs: number, lambda: number): UpstreamTrade[] {
  const rand = mulberry32(hashString(`${kind}:${bucketIndex}`) ^ UNIVERSE_SEED);
  const count = poisson(rand, lambda);
  const out: UpstreamTrade[] = [];
  for (let k = 0; k < count; k++) {
    const trader = pickWeighted(rand, universe.traders, (t) => t.activity);
    const favorite = rand() < 0.6;
    const token = favorite
      ? universe.tokens[trader.favorites[Math.floor(rand() * trader.favorites.length)]]
      : pickWeighted(rand, universe.tokens, (t) => t.popularity * (1 + trader.skill * Math.max(0, t.drift) * 40));
    const side: Side = rand() < 0.56 ? "BUY" : "SELL";
    const ts = bucketIndex * bucketMs + Math.floor(rand() * bucketMs);
    const price = priceAt(token, ts);
    const sizeJitter = Math.exp((rand() - 0.5) * 1.8);
    const amountUsd = Math.round(trader.typicalSize * sizeJitter * 100) / 100;
    out.push({
      id: `mock-${kind}-${bucketIndex}-${k}`,
      txHash: `0x${hex(rand, 64)}`,
      wallet: trader.wallet,
      side,
      tokenAddress: token.address,
      tokenSymbol: token.symbol,
      tokenName: token.name,
      amountUsd,
      tokenAmount: amountUsd / price,
      price,
      nativeAmount: amountUsd / 3200,
      dex: "Mock DEX",
      timestamp: new Date(ts).toISOString(),
    });
  }
  return out;
}

function tradesBetween(from: number, to: number): UpstreamTrade[] {
  const out: UpstreamTrade[] = [];
  const hStart = Math.floor(from / HISTORY_BUCKET_MS);
  const hEnd = Math.floor(to / HISTORY_BUCKET_MS);
  for (let b = hStart; b <= hEnd; b++) out.push(...generateBucket("h", b, HISTORY_BUCKET_MS, HISTORY_LAMBDA));

  const liveFrom = Math.max(from, to - LIVE_HORIZON_MS);
  const lStart = Math.floor(liveFrom / LIVE_BUCKET_MS);
  const lEnd = Math.floor(to / LIVE_BUCKET_MS);
  for (let b = lStart; b <= lEnd; b++) out.push(...generateBucket("l", b, LIVE_BUCKET_MS, LIVE_LAMBDA));

  return out
    .filter((t) => {
      const ts = Date.parse(t.timestamp);
      return ts > from && ts <= to;
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function toPnlInput(t: UpstreamTrade): PnlInputTrade {
  return {
    id: t.id,
    wallet: t.wallet,
    tokenAddress: t.tokenAddress,
    side: t.side,
    amountUsd: t.amountUsd ?? 0,
    tokenAmount: t.tokenAmount,
    timestamp: Date.parse(t.timestamp),
  };
}

function periodMs(period: RankingPeriod): number {
  switch (period) {
    case "24h":
      return DAY;
    case "7d":
      return 7 * DAY;
    case "30d":
      return 30 * DAY;
    case "all":
      return HISTORY_DAYS * DAY;
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const mockProvider: DataProvider = {
  name: "mock",
  isMock: true,

  async fetchTraders(): Promise<UpstreamTrader[]> {
    const now = Date.now();
    const trades = tradesBetween(now - DAY, now).map(toPnlInput);
    const summary = summarizeWallets(trades, computePnl(trades));
    return universe.traders.map((t) => ({
      wallet: t.wallet,
      name: t.name,
      handle: t.handle,
      pnl24h: summary.get(t.wallet)?.realizedPnl ?? 0,
    }));
  },

  async fetchLeaderboard(period: RankingPeriod): Promise<UpstreamRankingRow[]> {
    const now = Date.now();
    // Positions need full history so cost basis is right; PnL is attributed to sells in-window.
    const all = tradesBetween(now - HISTORY_DAYS * DAY, now).map(toPnlInput);
    const pnl = computePnl(all);
    const from = now - periodMs(period);
    const inWindow = all.filter((t) => t.timestamp > from);
    const summary = summarizeWallets(inWindow, pnl);
    return [...summary.values()]
      .map((s) => {
        const trader = traderByWallet.get(s.wallet);
        return {
          wallet: s.wallet,
          name: trader?.name ?? s.wallet,
          pnl: s.realizedPnl ?? 0,
          trades: s.trades,
          buys: s.buys,
          sells: s.sells,
          bestTradeUsd: s.bestTradeUsd ?? undefined,
          roi: s.roi ?? undefined,
          winRate: s.winRate ?? undefined,
        };
      })
      .sort((a, b) => b.pnl - a.pnl);
  },

  async fetchTrades(opts: FetchTradesOptions): Promise<UpstreamTrade[]> {
    const now = Date.now();
    const from = opts.after ? Date.parse(opts.after) : now - HISTORY_DAYS * DAY;
    return tradesBetween(from, now).slice(0, opts.limit);
  },

  async fetchTraderProfile(wallet: string): Promise<UpstreamTraderProfile | null> {
    const trader = traderByWallet.get(wallet.toLowerCase());
    if (!trader) return null;
    const now = Date.now();
    const all = tradesBetween(now - HISTORY_DAYS * DAY, now)
      .filter((t) => t.wallet === trader.wallet)
      .map(toPnlInput);
    const pnl = computePnl(all);
    const summary = summarizeWallets(all, pnl).get(trader.wallet);
    const holdings = [...pnl.positions.values()]
      .filter((p) => p.qty > 0)
      .map((p) => {
        const token = tokenByAddress.get(p.tokenAddress);
        const usdValue = token ? p.qty * priceAt(token, now) : 0;
        return { tokenAddress: p.tokenAddress, symbol: token?.symbol ?? "?", usdValue };
      })
      .sort((a, b) => b.usdValue - a.usdValue);
    return {
      wallet: trader.wallet,
      name: trader.name,
      realizedPnl: summary?.realizedPnl ?? 0,
      volumeUsd: summary?.volumeUsd ?? 0,
      totalTrades: summary?.trades ?? 0,
      winRate: summary?.winRate ?? undefined,
      bestTradeUsd: summary?.bestTradeUsd ?? undefined,
      nativeBalance: Math.round((5 + trader.typicalSize / 400) * 100) / 100,
      holdings,
    };
  },

  async fetchTokenActivity(): Promise<UpstreamTokenActivity[]> {
    const now = Date.now();
    const recent = tradesBetween(now - DAY, now);
    return universe.tokens.map((token) => {
      const mine = recent.filter((t) => t.tokenAddress === token.address);
      const wallets = new Set(mine.map((t) => t.wallet));
      const net = mine.reduce((acc, t) => acc + (t.side === "BUY" ? t.amountUsd ?? 0 : -(t.amountUsd ?? 0)), 0);
      const volume = mine.reduce((acc, t) => acc + (t.amountUsd ?? 0), 0);
      const price = priceAt(token, now);
      const prev = priceAt(token, now - DAY);
      const last = mine[0]?.timestamp;
      return {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        lastActivityAt: last,
        kolCount: wallets.size,
        netInflowUsd: net,
        volume24hUsd: volume * 14 + token.popularity * 25_000, // tracked flow is a slice of total volume
        price,
        marketCap: price * token.supply,
        priceChange24h: ((price - prev) / prev) * 100,
      };
    });
  },
};

/** Exposed for the seed script so seeded discussions can reference real mock symbols/handles. */
export const mockUniverse = {
  traders: universe.traders.map((t) => ({ wallet: t.wallet, name: t.name, handle: t.handle })),
  tokens: universe.tokens.map((t) => ({ address: t.address, symbol: t.symbol, name: t.name })),
};
