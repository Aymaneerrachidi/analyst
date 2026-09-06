import "server-only";
import { readCache, writeCache } from "./persistent-cache";
import { z } from "zod";

const detailsSchema = z.object({ token: z.string(), name: z.string(), symbol: z.string(), decimals: z.number(), totalSupplyWei: z.string(), logo: z.string().optional(), quoteAsset: z.object({ decimals: z.number(), symbol: z.string(), assetClass: z.string().optional() }) });
export interface LaunchpadToken { address: string; name: string; symbol: string; image?: string; price: number | null; fdv: number | null }
const cache = new Map<string, { at: number; token: LaunchpadToken | null }>();
const inflight = new Map<string, Promise<LaunchpadToken | null>>();

/** Contract-matched metadata published by the launchpad itself. */
export async function fetchLaunchpadToken(address: string): Promise<LaunchpadToken | null> {
  address = address.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return null;
  let hit = cache.get(address);
  if (!hit) { hit = await readCache<{ at: number; token: LaunchpadToken | null }>("launchpad-cache", address) ?? undefined; if (hit) cache.set(address, hit); }
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.token;
  const active = inflight.get(address); if (active) return active;
  const task = (async () => {
    const response = await fetch(`https://www.ponsfamily.com/launchpad/${address}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!response.ok) return null;
    const html = await response.text();
    const flight = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map((match) => { try { return JSON.parse(match[1]) as string; } catch { return ""; } }).join("");
    const match = flight.match(/"initialDetails":(\{[\s\S]*?\}),"initialPriceQuote":([^,}]+),"quoteUsd":([^,}]+)/);
    if (!match) return null;
    const parsed = detailsSchema.safeParse(JSON.parse(match[1]));
    if (!parsed.success || parsed.data.token.toLowerCase() !== address) return null;
    const details = parsed.data;
    const quoted = Number(match[2]); const usd = Number(match[3]);
    const price = quoted > 0 && usd > 0 && Number.isFinite(quoted * usd) ? quoted * usd : null;
    const supply = Number(details.totalSupplyWei) / 10 ** details.decimals;
    const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    const token: LaunchpadToken = { address, name: details.name, symbol: details.symbol, image: details.logo && image ? image : undefined, price, fdv: price && Number.isFinite(supply) ? price * supply : null };
    const entry = { token, at: Date.now() }; cache.set(address, entry);
    await writeCache("launchpad-cache", address, entry);
    return token;
  })().catch(() => hit?.token ?? null).then((token) => {
    if (!token) cache.set(address, { at: Date.now(), token: null });
    return token;
  });
  inflight.set(address, task);
  try { return await task; } finally { inflight.delete(address); }
}

const chartCache = new Map<string, { at: number; data: { candles: { t: number; close: number; volume: number }[]; unit: string } }>();
export async function fetchLaunchpadChart(address: string, window: "1h" | "6h" | "24h" | "7d") {
  if (!/^0x[a-f0-9]{40}$/i.test(address)) return null;
  const key = `${address.toLowerCase()}:${window}`;
  const hit = chartCache.get(key); if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const range = window === "24h" ? "1d" : window === "7d" ? "all" : window;
  try {
    const response = await fetch(`https://www.ponsfamily.com/api/pons-v2-market/${address}/chart?range=${range}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!response.ok) return hit?.data ?? null;
    const parsed = z.object({ token: z.string(), quoteSymbol: z.string(), points: z.array(z.object({ t: z.number(), price: z.number().positive(), volumeQuote: z.number() })) }).safeParse(await response.json());
    if (!parsed.success || parsed.data.token.toLowerCase() !== address.toLowerCase()) return null;
    const from = Date.now() - { "1h": 1, "6h": 6, "24h": 24, "7d": 168 }[window] * 3_600_000;
    // Keep the actual quote currency: today's FX rate must not rewrite historical USD prices.
    const candles = parsed.data.points.filter(p => p.t * 1000 >= from).map(p => ({ t: p.t * 1000, close: p.price, volume: p.volumeQuote })).sort((a,b)=>a.t-b.t);
    const data = { candles, unit: parsed.data.quoteSymbol };
    chartCache.set(key, { at: Date.now(), data }); return data;
  } catch { return hit?.data ?? null; }
}

export async function cachedLaunchpadToken(address: string): Promise<{ token: LaunchpadToken; at: number } | null> {
  if (!/^0x[a-f0-9]{40}$/i.test(address)) return null;
  const hit = cache.get(address.toLowerCase());
  if (hit?.token) return { token: hit.token, at: hit.at };
  try {
    const stored = await readCache<{ token: LaunchpadToken; at: number }>("launchpad-cache", address.toLowerCase());
    return stored?.token?.address === address.toLowerCase() ? stored : null;
  } catch { return null; }
}
