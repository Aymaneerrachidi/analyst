import { z } from 'zod';
import type { RankingMetric } from './leaderboard-data';

const row = z.object({ wallets: z.array(z.string().regex(/^0x[\da-f]{40}$/i)), realizedUsd: z.number().finite(), volumeUsd: z.number().finite().nonnegative(), trades: z.number().int().nonnegative(), basisIncomplete: z.boolean().optional() });
/** Group totals cannot be assigned to each wallet. The API's win rate is a
 * lifetime position statistic, so it must not be presented as a period win rate. */
export function normalizeStalkRankings(input: unknown, period: RankingMetric['period'], observedAt: string): RankingMetric[] {
  const body = z.object({ data: z.object({ leaderboard: z.array(z.unknown()), meta: z.object({ window: z.string(), updatedAt: z.iso.datetime() }) }) }).parse(input);
  if (body.data.meta.window !== period) throw new Error('Ranking period mismatch');
  observedAt = body.data.meta.updatedAt;
  return body.data.leaderboard.flatMap(value => {
    const parsed = row.safeParse(value);
    if (!parsed.success || parsed.data.wallets.length !== 1) return [];
    const r = parsed.data;
    return [{ wallet: r.wallets[0].toLowerCase(), period, pnl: r.realizedUsd, volumeUsd: r.volumeUsd, trades: r.trades, roi: null, winRate: null, source: 'Stalkchain' as const, observedAt, basisIncomplete: r.basisIncomplete ?? true }];
  });
}

export function mergeRankings(defined: RankingMetric[], stalk: RankingMetric[], now = Date.now()): RankingMetric[] {
  const rows = new Map(stalk.map(row => [`${row.wallet}:${row.period}`, row]));
  for (const row of defined) {
    const at = Date.parse(row.observedAt ?? '');
    if (Number.isFinite(at) && now - at >= -60_000 && (now - at < 2 * 3_600_000 || !rows.has(`${row.wallet}:${row.period}`))) rows.set(`${row.wallet}:${row.period}`, row);
  }
  return [...rows.values()];
}
