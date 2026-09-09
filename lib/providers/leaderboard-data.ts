import { z } from 'zod';
import { sourceNumber } from './defined-import';

const record = z.object({ address: z.string().regex(/^0x[\da-f]{40}$/i), networkId: z.literal(4663) }).passthrough();
export const rankingPeriods = { '24h': '1d', '7d': '1w', '30d': '30d' } as const;
export type RankingMetric = { wallet: string; period: keyof typeof rankingPeriods; pnl: number; roi: number | null; winRate: number | null; trades: number | null; volumeUsd: number | null };
export function normalizeLeaderboard(input: unknown): RankingMetric[] {
  const rows = z.array(record).parse(input); const result = new Map<string, RankingMetric>();
  for (const row of rows) for (const [period, suffix] of Object.entries(rankingPeriods)) {
    const pnl = sourceNumber(row[`realizedProfitUsd${suffix}`]);
    if (pnl === null) continue;
    const winRate = sourceNumber(row[`winRate${suffix}`]), trades = sourceNumber(row[`swaps${suffix}`]), volume = sourceNumber(row[`volumeUsd${suffix}`]);
    const wallet = row.address.toLowerCase();
    result.set(`${wallet}:${period}`, { wallet, period: period as RankingMetric['period'], pnl,
      roi: sourceNumber(row[`realizedProfitPercentage${suffix}`]), winRate: winRate !== null && winRate >= 0 && winRate <= 100 ? winRate : null,
      trades: trades !== null && Number.isSafeInteger(trades) && trades >= 0 ? trades : null, volumeUsd: volume !== null && volume >= 0 ? volume : null });
  }
  return [...result.values()];
}

export const LEADERBOARD_QUERY = `query AnalystRankings($input: FilterWalletsInput!) { filterWallets(input: $input) { results { address networkId ${Object.values(rankingPeriods).map(s => `realizedProfitUsd${s} realizedProfitPercentage${s} winRate${s} swaps${s} volumeUsd${s}`).join(' ')} } } }`;
