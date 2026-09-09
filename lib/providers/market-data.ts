/**
 * MARKET DATA ENRICHMENT — token price / market cap / volume for live mode.
 *
 * KOLHOOD exposes trader activity but no token prices. Dexscreener's documented public API
 * (https://docs.dexscreener.com/api/reference — `GET /tokens/v1/{chainId}/{addresses}`, up to 30
 * addresses per call, 300 requests/min, no key) covers Robinhood Chain as `chainId=robinhood`.
 * Results are cached in memory for a minute and the pair with the deepest liquidity wins.
 */
import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { v2Config } from "@/lib/v2/config";
import { fetchGeckoTokens } from "./geckoterminal";
import { fetchLaunchpadToken } from "./launchpad";

export interface MarketQuote {
  source?: string;
  observedAt?: string;
  volume5m?: number | null;
  volume1h?: number | null;
  volume6h?: number | null;
  priceChange5m?: number | null;
  priceChange1h?: number | null;
  buys5m?: number | null;
  sells5m?: number | null;
  pairAddress?: string;
  address: string;
  price: number | null;
  marketCap: number | null;
  fdv?: number | null;
  volume24h: number | null;
  priceChange24h: number | null;
  name?: string;
  symbol?: string;
  image?: string;
  liquidityUsd: number;
}

const num = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === "number" ? v : (v.trim() ? Number(v) : NaN);
  return Number.isFinite(n) ? n : null;
});

const pairSchema = z.object({
  chainId: z.string(),
  baseToken: z.object({ address: z.string(), name: z.string().nullish(), symbol: z.string().nullish() }),
  priceUsd: num.nullish(),
  pairAddress: z.string().optional(),
  volume: z.object({ h24: num.nullish(), h1: num.nullish(), h6: num.nullish(), m5: num.nullish() }).nullish(),
  priceChange: z.object({ h24: num.nullish(), h1: num.nullish(), m5: num.nullish() }).nullish(),
  txns: z.object({ m5: z.object({ buys: num.nullish(), sells: num.nullish() }).nullish() }).nullish(),
  liquidity: z.object({ usd: num.nullish() }).nullish(),
  marketCap: num.nullish(),
  fdv: num.nullish(),
  info: z.object({ imageUrl: z.string().nullish() }).nullish(),
});



type CacheEntry = { quote: MarketQuote | null; at: number; launchpad?: boolean };
const g = globalThis as unknown as { __analystMarketCache?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = g.__analystMarketCache ?? (g.__analystMarketCache = new Map());
const TTL_MS = 60_000;
const BATCH = 30;

export function marketDataEnabled(): boolean {
  return env().MARKET_DATA_PROVIDER === "dexscreener";
}

async function fetchBatch(addresses: string[]): Promise<Map<string, MarketQuote>> {
  const chain = env().MARKET_DATA_CHAIN;
  const url = `${v2Config().DEXSCREENER_BASE_URL.replace(/\/$/, "")}/tokens/v1/${encodeURIComponent(chain)}/${addresses.join(",")}`;
  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Dexscreener ${res.status}`);
  return normalizeDexPairs(await res.json(), addresses, chain);
}

/** Only exact chain/address matches; a malformed pool cannot discard other valid pools. */
export function normalizeDexPairs(payload: unknown, addresses: string[], chain: string): Map<string, MarketQuote> {
  if (!Array.isArray(payload)) throw new Error("Invalid Dexscreener response");
  const out = new Map<string, MarketQuote>();
  const wanted = new Set(addresses.map(address => address.toLowerCase()));
  const positive = (value: number | null | undefined) => value != null && value > 0 ? value : null;
  const nonnegative = (value: number | null | undefined) => value != null && value >= 0 ? value : null;
  for (const raw of payload) {
    const parsed = pairSchema.safeParse(raw);
    if (!parsed.success) continue;
    const pair = parsed.data;
    if (pair.chainId !== chain) continue;
    const address = pair.baseToken.address.toLowerCase();
    if (!wanted.has(address)) continue; // only base-token quotes
    const liquidityUsd = nonnegative(pair.liquidity?.usd) ?? 0;
    const prev = out.get(address);
    if (prev && prev.liquidityUsd >= liquidityUsd) continue;
    out.set(address, {
      address, source: "Dexscreener", observedAt: new Date().toISOString(),
      price: positive(pair.priceUsd),
      marketCap: nonnegative(pair.marketCap),
      fdv: nonnegative(pair.fdv),
      volume24h: nonnegative(pair.volume?.h24),
      volume5m: nonnegative(pair.volume?.m5),
      volume1h: nonnegative(pair.volume?.h1),
      volume6h: nonnegative(pair.volume?.h6),
      priceChange5m: pair.priceChange?.m5 ?? null,
      priceChange1h: pair.priceChange?.h1 ?? null,
      buys5m: pair.txns?.m5?.buys ?? null,
      sells5m: pair.txns?.m5?.sells ?? null,
      pairAddress: pair.pairAddress,
      priceChange24h: pair.priceChange?.h24 ?? null,
      name: pair.baseToken.name ?? undefined,
      symbol: pair.baseToken.symbol ?? undefined,
      image: pair.info?.imageUrl ?? undefined,
      liquidityUsd,
    });
  }
  return out;
}

/** Returns quotes for the given token addresses (lowercase). Missing tokens are simply absent. */
export async function fetchMarketQuotes(addresses: string[], includeLaunchpad = true): Promise<Map<string, MarketQuote>> {
  const result = new Map<string, MarketQuote>();
  if (!marketDataEnabled()) return result;
  const now = Date.now();
  const missing: string[] = [];
  for (const raw of new Set(addresses.map((a) => a.toLowerCase()))) {
    const hit = cache.get(raw);
    if (hit && now - hit.at < TTL_MS && (!includeLaunchpad || hit.launchpad)) {
      if (hit.quote) result.set(raw, hit.quote);
    } else {
      missing.push(raw);
    }
  }
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    try {
      const [dex, gecko] = await Promise.allSettled([fetchBatch(batch), fetchGeckoTokens(batch)]);
      const quotes = dex.status === "fulfilled" ? dex.value : new Map<string, MarketQuote>();
      if (gecko.status === "fulfilled") {
        for (const [address, token] of gecko.value) {
          const existing = quotes.get(address);
          quotes.set(address, existing ? { ...existing, price: existing.price ?? token.price, marketCap: existing.marketCap ?? token.marketCap, fdv: existing.fdv ?? token.fdv, volume24h: existing.volume24h ?? token.volume24h, priceChange24h: existing.priceChange24h ?? token.priceChange24h ?? null, image: existing.image || token.image, name: token.name || existing.name } : { ...token, source: "GeckoTerminal", observedAt: new Date().toISOString(), priceChange24h: token.priceChange24h ?? null });
        }
      }
      if (dex.status === "rejected" && gecko.status === "rejected") throw dex.reason;
      const incomplete = includeLaunchpad ? batch.filter((address) => !quotes.get(address)?.image || quotes.get(address)?.price == null) : [];
      for (let offset = 0; offset < incomplete.length; offset += 6) {
        const launchpad = await Promise.all(incomplete.slice(offset, offset + 6).map(fetchLaunchpadToken));
        for (const token of launchpad) {
          if (!token) continue;
          const previous = quotes.get(token.address);
          quotes.set(token.address, { ...previous, source: previous?.source ?? "Pons launchpad", observedAt: previous?.observedAt ?? new Date().toISOString(), address: token.address, name: token.name, symbol: token.symbol, marketCap: previous?.marketCap ?? null, price: previous?.price ?? token.price, fdv: previous?.fdv ?? token.fdv, volume24h: previous?.volume24h ?? null, priceChange24h: previous?.priceChange24h ?? null, liquidityUsd: previous?.liquidityUsd ?? 0, image: previous?.image || token.image });
        }
      }
      for (const a of batch) {
        const q = quotes.get(a) ?? null;
        cache.set(a, { quote: q, at: Date.now(), launchpad: includeLaunchpad });
        if (q) result.set(a, q);
      }
    } catch (err) {
      console.error("[market-data]", err instanceof Error ? err.message : err);
      break;
    }
  }
  return result;
}

/** One bounded public API batch. Throws on failure so callers back off rather than save empty success. */
export async function fetchDexQuotes(addresses: string[]): Promise<Map<string, MarketQuote>> {
  const unique = [...new Set(addresses.map(address => address.toLowerCase()))];
  if (unique.length > 30 || unique.some(address => !/^0x[a-f0-9]{40}$/.test(address))) throw new Error("Invalid Dexscreener batch");
  return unique.length ? fetchBatch(unique) : new Map();
}
