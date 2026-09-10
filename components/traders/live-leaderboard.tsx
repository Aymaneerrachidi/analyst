'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/client/fetcher';
import type { AnalystTrader, RankingPeriod } from '@/lib/types';
import { TraderTable } from './trader-table';

export function LiveLeaderboard({ initial, initialStatus, period, filter, query, page }: { initial: AnalystTrader[]; initialStatus: { wallets: number; automatic: boolean; partial?: boolean } | null; period: RankingPeriod; filter: string; query: string; page: number }) {
  const params = new URLSearchParams({ period, filter, q: query, limit: '25', offset: String((page - 1) * 25) });
  const { data, isError } = useQuery({ queryKey: ['leaderboard', period, filter, query, page], queryFn: ({ signal }) => apiGet<{ traders: AnalystTrader[]; rankingStatus?: { wallets: number; automatic: boolean; partial?: boolean } | null }>(`/api/traders?${params}`, signal), initialData: { traders: initial, rankingStatus: initialStatus }, refetchInterval: 30_000, staleTime: 15_000 });
  const capturedAt = data.traders.map(t => t.statsUpdatedAt).filter((t): t is string => Boolean(t)).sort()[0];
  return <><div className="mb-3 flex items-center justify-between text-xs text-muted"><span>{isError ? 'Refresh unavailable · showing saved rankings' : capturedAt ? `Updated ${new Date(capturedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Awaiting ranking data'}</span><span>{data.rankingStatus ? `${data.rankingStatus.wallets} ranked wallets${data.rankingStatus.automatic ? '' : ' · saved snapshot'}` : 'Checks every 30s'}</span></div><TraderTable traders={data.traders} emptyTitle={period === 'all' ? 'Complete all-time rankings are not available yet.' : query ? `No traders match “${query}”.` : undefined} /></>;
}
