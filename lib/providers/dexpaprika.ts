import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readCache, writeCache } from './persistent-cache';
import { reserveProviderRequest } from './request-budget';
import type { FlowWindow, TokenCandle } from '@/lib/types';

const point = z.object({ time_open: z.string().datetime(), open: z.number().positive(), high: z.number().positive(), low: z.number().positive(), close: z.number().positive(), volume: z.number().nonnegative() });
export function parsePaprikaCandles(value: unknown, from: number, now: number): TokenCandle[] {
  const result = z.array(point).safeParse(value);
  if (!result.success) return [];
  const unique = new Map<number, TokenCandle>();
  for (const c of result.data) { const t = Date.parse(c.time_open); if (t >= from && t <= now && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close)) unique.set(t, { t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }); }
  return [...unique.values()].sort((a, b) => a.t - b.t);
}
async function request(path: string, ttl: number): Promise<unknown> {
  const key = createHash('sha256').update(path.replace(/start=[^&]+/, 'start=rolling')).digest('hex');
  const cached = await readCache<{ at: number; value: unknown }>('paprika', key);
  if (cached && Date.now() - cached.at < ttl) return cached.value;
  if (!await reserveProviderRequest('dexpaprika', 12)) { if (cached) return cached.value; throw new Error('Chart provider budget reached'); }
  const response = await fetch('https://api.dexpaprika.com'+path, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
  if (!response.ok) { if (cached) return cached.value; throw new Error(`Chart provider ${response.status}`); }
  const value: unknown = await response.json();
  await writeCache('paprika', key, { value, at: Date.now() });
  return value;
}

export async function fetchPaprikaCandles(address: string, window: FlowWindow) {
  const pools = z.object({ results: z.array(z.object({ id: z.string().regex(/^0x[\da-f]+$/i), chain: z.literal('robinhood'), liquidity_usd: z.number().nullish(), tokens: z.array(z.object({ id: z.string() })) })) }).parse(await request(`/networks/robinhood/pools/search?token_address=${address}&limit=10&order_by=liquidity_usd&sort=desc`, 600_000));
  // The API quotes token0 in token1. Only accept the requested token as token0;
  // label the quote currency explicitly instead of converting at today's price.
  const pool = pools.results.find(p => p.tokens[0]?.id.toLowerCase() === address.toLowerCase());
  if (!pool) return null;
  const quote = pool.tokens[1]?.id.toLowerCase();
  const unit = quote === '0x5fc5360d0400a0fd4f2af552add042d716f1d168' ? 'USDG' : quote ? `${quote.slice(0,6)}…${quote.slice(-4)}` : 'Quote token';
  const interval = { '1h': '1m', '6h': '5m', '24h': '15m', '7d': '1h' }[window];
  const span = { '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000, '7d': 604_800_000 }[window];
  const now = Date.now(), from = Math.floor((now-span)/60_000)*60_000;
  const raw = await request(`/networks/robinhood/pools/${pool.id}/ohlcv?start=${new Date(from).toISOString()}&interval=${interval}&limit=200`, 60_000);
  return { candles: parsePaprikaCandles(raw, from, now), unit, liquidityUsd: pool.liquidity_usd, marketUrl: `https://dexpaprika.com/robinhood/pool/${pool.id}` };
}
