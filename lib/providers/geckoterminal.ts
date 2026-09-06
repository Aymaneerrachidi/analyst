import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { createHash } from "node:crypto";
import { readCache, writeCache } from "./persistent-cache";

const API = "https://api.geckoterminal.com/api/v2";
type Cached = { value: unknown; at: number };
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<unknown>>();
let retryAfter = 0;

/** Public, credential-free market data. Cache and deduplicate to respect upstream limits. */
export async function geckoJson(path: string, ttl = 5 * 60_000): Promise<unknown> {
  let hit = cache.get(path);
  const key = createHash("sha256").update(path).digest("hex");
  if (!hit && !process.env.NODE_TEST_CONTEXT) {
    hit = await readCache<Cached>("market-cache", key) ?? undefined;
    if (hit) cache.set(path, hit);
  }
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  if (Date.now() < retryAfter) {
    if (hit) return hit.value;
    throw new Error("Market data is temporarily rate limited.");
  }
  const pending = inflight.get(path);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetch(`${API}${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (response.status === 429) retryAfter = Date.now() + 60_000;
    if (!response.ok && response.status !== 404) throw new Error(`Market data returned ${response.status}.`);
    const value: unknown = response.status === 404 ? null : await response.json();
    if (cache.size >= 500) cache.delete(cache.keys().next().value!);
    cache.set(path, { value, at: Date.now() });
    if (!process.env.NODE_TEST_CONTEXT) {
      await writeCache("market-cache", key, { value, at: Date.now() });
    }
    return value;
  })();
  inflight.set(path, request);
  try { return await request; } catch (error) { if (hit) return hit.value; throw error; } finally { inflight.delete(path); }
}

const num = z.union([z.number(), z.string()]).nullish().transform((value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
});
const tokenSchema = z.object({
  attributes: z.object({
    address: z.string(), name: z.string(), symbol: z.string(), image_url: z.string().nullish(),
    price_usd: num, market_cap_usd: num, fdv_usd: num, total_reserve_in_usd: num,
    volume_usd: z.object({ h24: num }).nullish(),
  }),
  relationships: z.object({ top_pools: z.object({ data: z.array(z.object({ id: z.string() })) }) }).optional(),
});

export interface GeckoToken {
  address: string; name: string; symbol: string; image?: string;
  price: number | null; marketCap: number | null; fdv: number | null;
  volume24h: number | null; priceChange24h?: number | null; liquidityUsd: number; poolAddress?: string;
}

// Share metadata between bulk enrichment and individual chart requests.
const tokenCache = new Map<string, { token: GeckoToken | null; at: number }>();

export async function fetchGeckoTokens(addresses: string[]): Promise<Map<string, GeckoToken>> {
  const out = new Map<string, GeckoToken>();
  const chain = env().MARKET_DATA_CHAIN;
  const valid = [...new Set(addresses.map((a) => a.toLowerCase()).filter((a) => /^0x[a-f0-9]{40}$/.test(a)))];
  const missing = valid.filter((address) => {
    const hit = tokenCache.get(`${chain}:${address}`);
    if (!hit || Date.now() - hit.at > 15 * 60_000) return true;
    if (hit.token) out.set(address, hit.token);
    return false;
  });
  for (let i = 0; i < missing.length; i += 30) {
    const batch = missing.slice(i, i + 30).sort();
    let raw: unknown;
    try { raw = await geckoJson(`/networks/${encodeURIComponent(chain)}/tokens/multi/${batch.join(",")}?include=top_pools`); }
    catch (error) { if (out.size) break; throw error; }
    const parsed = z.object({ data: z.array(z.unknown()), included: z.array(z.unknown()).optional() }).safeParse(raw);
    if (!parsed.success) continue;
    const pools = parsed.data.included?.flatMap((value) => {
      const pool = z.object({ id: z.string(), attributes: z.object({ volume_usd: z.object({ h24: num }).nullish(), price_change_percentage: z.object({ h24: num }).nullish(), reserve_in_usd: num }) }).safeParse(value);
      return pool.success ? [pool.data] : [];
    });
    for (const value of parsed.data.data) {
      const entry = tokenSchema.safeParse(value);
      if (!entry.success) continue;
      const token = entry.data;
      const a = token.attributes;
      const poolId = token.relationships?.top_pools.data[0]?.id;
      const pool = pools?.find((p) => p.id === poolId)?.attributes;
      out.set(a.address.toLowerCase(), {
        address: a.address.toLowerCase(), name: a.name, symbol: a.symbol,
        image: a.image_url || undefined, price: a.price_usd, marketCap: a.market_cap_usd,
        fdv: a.fdv_usd, volume24h: a.volume_usd?.h24 ?? pool?.volume_usd?.h24 ?? null,
        priceChange24h: pool?.price_change_percentage?.h24 ?? null,
        liquidityUsd: a.total_reserve_in_usd ?? pool?.reserve_in_usd ?? 0,
        poolAddress: poolId?.startsWith(`${chain}_`) ? poolId.slice(chain.length + 1) : undefined,
      });
    }
    for (const address of batch) tokenCache.set(`${chain}:${address}`, { token: out.get(address) ?? null, at: Date.now() });
    while (tokenCache.size > 2000) tokenCache.delete(tokenCache.keys().next().value!);
  }
  return out;
}

export interface PriceCandle { t: number; open: number; high: number; low: number; close: number; volume: number }

export async function fetchTokenCandles(address: string, window: "1h" | "6h" | "24h" | "7d") {
  const token = (await fetchGeckoTokens([address])).get(address.toLowerCase());
  if (!token?.poolAddress) return { candles: [] as PriceCandle[], marketUrl: null, token };
  const period = window === "7d" ? "hour" : "minute";
  const aggregate = window === "1h" ? 1 : window === "6h" ? 5 : window === "24h" ? 15 : 1;
  const path = `/networks/${encodeURIComponent(env().MARKET_DATA_CHAIN)}/pools/${encodeURIComponent(token.poolAddress)}/ohlcv/${period}?aggregate=${aggregate}&limit=200&currency=usd&token=${encodeURIComponent(address.toLowerCase())}`;
  const raw = await geckoJson(path, 60_000);
  const parsed = z.object({ data: z.object({ attributes: z.object({ ohlcv_list: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])) }) }) }).safeParse(raw);
  const hours = { "1h": 1, "6h": 6, "24h": 24, "7d": 168 }[window];
  const from = Date.now() - hours * 3_600_000;
  const candles = parsed.success ? parsed.data.data.attributes.ohlcv_list
    .filter(([t]) => t * 1000 >= from)
    .map(([t, open, high, low, close, volume]) => ({ t: t * 1000, open, high, low, close, volume }))
    .sort((a, b) => a.t - b.t) : [];
  return { candles, marketUrl: `https://www.geckoterminal.com/${encodeURIComponent(env().MARKET_DATA_CHAIN)}/pools/${encodeURIComponent(token.poolAddress)}`, token };
}
