"use client";
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/client/fetcher';
import type { Freshness } from '@/lib/types';
import { cn } from '@/lib/utils';
export function useFreshness(initial?: Freshness) {
  return useQuery({ queryKey: ['freshness'], queryFn: () => apiGet<Freshness>('/api/freshness'), initialData: initial, refetchInterval: 15_000, staleTime: 10_000 });
}
export function LiveIndicator({ initial, showTracked, className }: { initial?: Freshness; showTracked?: boolean; size?: 'sm' | 'md'; className?: string }) {
  const { data } = useFreshness(initial);
  const at = data?.lastTradeAt;
  const valid = at && Number.isFinite(Date.parse(at));
  return <span className={cn('inline-flex flex-wrap items-center gap-2 text-[11px] text-muted tnum', className)}>
    {valid && <time dateTime={at} title="Time of the latest recorded trade">Latest trade {new Date(at).toISOString().slice(0,16).replace('T',' ')} UTC</time>}
    {showTracked && data && <span>{data.trackedTraders} tracked traders</span>}
    {data?.isMock && <span className="text-warning">MOCK DATA</span>}
  </span>;
}
