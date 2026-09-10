import { z } from 'zod';
import type { UpstreamTrade } from './types';

const address = z.string().regex(/^0x[\da-f]{40}$/i).transform(v => v.toLowerCase());
const amount = z.number().finite().nonnegative().nullish();
const trade = z.object({ kind: z.literal('trade'), time: z.string().datetime(), wallet: address, token: address,
  txHash: z.string().regex(/^0x[\da-f]{64}$/i).transform(v => v.toLowerCase()), side: z.enum(['buy', 'sell']),
  symbol: z.string().nullish(), name: z.string().nullish(), venue: z.string().nullish(), tokenAmount: amount, ethAmount: amount, usdAmount: amount,
  priceIsSane: z.boolean().optional(), priceQuality: z.string().optional(),
});

export function parseStalkTrade(value: unknown, wallet?: string): UpstreamTrade | null {
  if (!value || typeof value !== 'object') return null;
  const result = trade.safeParse({ ...value, ...(wallet ? { wallet } : {}) });
  if (!result.success) return null;
  const row = result.data;
  if (Date.parse(row.time) > Date.now() + 60_000) return null;
  const quantity = row.tokenAmount && row.tokenAmount > 0 ? row.tokenAmount : undefined;
  // Respect the source's explicit rejection of a price. Never turn an invalid
  // valuation into PnL, execution price, or market capitalization.
  const validPrice = row.priceIsSane !== false && !['insane', 'unverified'].includes(row.priceQuality ?? '');
  const usd = validPrice ? row.usdAmount ?? undefined : undefined;
  return { id: `stalkchain:${row.txHash}:${row.wallet}:${row.token}:${row.side.toUpperCase()}`, txHash: row.txHash,
    wallet: row.wallet, side: row.side.toUpperCase() as 'BUY' | 'SELL', tokenAddress: row.token,
    tokenSymbol: row.symbol || row.token.slice(0, 8), tokenName: row.name ?? undefined,
    tokenAmount: quantity, amountUsd: usd, price: quantity && usd !== undefined ? usd / quantity : undefined,
    nativeAmount: row.ethAmount ?? undefined, dex: row.venue ?? 'Stalkchain', timestamp: row.time };
}

export const stalkLeaderboard = z.object({ data: z.object({ leaderboard: z.array(z.object({ label: z.string(), wallets: z.array(address), avatar: z.string().url().nullish(), xLink: z.object({ url: z.string().url() }).nullish() })) }) });

export async function stalkGet(path: string) {
  const response = await fetch(`https://stalkchain.com/api/robinhood/${path}`, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Stalkchain HTTP ${response.status}`);
  return response.json();
}
