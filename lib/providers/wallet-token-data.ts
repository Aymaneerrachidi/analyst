import { z } from 'zod';
import { sourceNumber } from './defined-import';

const address = z.string().regex(/^0x[0-9a-f]{40}$/i).transform(value => value.toLowerCase());
const rowSchema = z.object({ address, tokenAddress: address, networkId: z.literal(4663), token: z.object({ name: z.string(), symbol: z.string() }).nullish() }).passthrough();
const periods = { '24h': '1d', '7d': '1w', '30d': '30d' } as const;
export type WalletTokenMetric = { address: string; name: string; symbol: string; period: keyof typeof periods; pnl: number | null; boughtUsd: number | null; soldUsd: number | null; buys: number | null; sells: number | null; holdingSeconds: number | null };
export function normalizeWalletTokens(input: unknown, wallet: string): WalletTokenMetric[] {
  const wanted = address.parse(wallet);
  if (!Array.isArray(input)) throw new Error('Invalid wallet token response');
  const result = new Map<string, WalletTokenMetric>();
  const nonnegative = (value: unknown) => { const n = sourceNumber(value); return n != null && n >= 0 ? n : null; };
  const count = (value: unknown) => { const n = nonnegative(value); return n != null && Number.isSafeInteger(n) ? n : null; };
  for (const raw of input) {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success || parsed.data.address !== wanted) continue;
    const r = parsed.data;
    for (const [period, suffix] of Object.entries(periods)) {
      const pnl = sourceNumber(r[`realizedProfitUsd${suffix}`]);
      const buys = count(r[`buys${suffix}`]), sells = count(r[`sells${suffix}`]);
      if (pnl == null && buys == null && sells == null) continue;
      result.set(`${r.tokenAddress}:${period}`, { address: r.tokenAddress, name: r.token?.name || r.tokenAddress, symbol: r.token?.symbol || r.tokenAddress.slice(0, 8), period: period as WalletTokenMetric['period'], pnl,
        boughtUsd: nonnegative(r[`amountBoughtUsd${suffix}`]), soldUsd: nonnegative(r[`amountSoldUsd${suffix}`]), buys, sells, holdingSeconds: nonnegative(r[`avgHoldPeriodSec${suffix}`]) });
    }
  }
  return [...result.values()];
}

export const WALLET_TOKENS_QUERY = `query AnalystWalletTokens($input: FilterTokenWalletsInput!) { filterTokenWallets(input: $input) { results { address tokenAddress networkId token { name symbol } ${Object.values(periods).map(s => `realizedProfitUsd${s} amountBoughtUsd${s} amountSoldUsd${s} buys${s} sells${s} avgHoldPeriodSec${s}`).join(' ')} } } }`;
