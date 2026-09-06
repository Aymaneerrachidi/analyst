"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTracking } from "@/lib/client/tracking-store";
import { useTradeStream } from "@/components/live/stream-provider";
import { apiGet } from "@/lib/client/fetcher";
import { mergeLiveTrades } from "@/lib/client/live-trades";
import type { AnalystTrade } from "@/lib/types";
import { TraderAvatar } from "@/components/common/avatar";
import { TradeTable } from "@/components/trades/trade-table";
import { FollowButton } from "./follow-button";
export function Following({ explorer }: { explorer: string }) {
  const { following } = useTracking();
  const stream = useTradeStream();
  const wallets = following.map(t => t.id).sort().join(",");
  const query = useQuery({ queryKey: ["following-trades", wallets], enabled: !!wallets, queryFn: ({ signal }) => apiGet<{ trades: AnalystTrade[] }>(`/api/trades?wallets=${wallets}&limit=100`, signal), refetchInterval: 10_000 });
  const ids = new Set(following.map(t => t.id));
  const trades = mergeLiveTrades(query.data?.trades ?? [], stream.trades.filter(t => ids.has(t.traderId.toLowerCase())), 100);
  return <div className="space-y-6"><div className="flex gap-4 text-sm"><Link className="text-neon" href="/traders">Find traders</Link><Link className="text-neon" href="/alerts">Create an alert</Link></div>
    {!following.length ? <p className="card p-6 text-secondary">Follow a trader from their profile to build your feed.</p> : <><ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{following.map(t => <li key={t.id} className="card flex items-center justify-between gap-2 p-3"><Link href={`/trader/${t.id}`} className="flex min-w-0 items-center gap-2"><TraderAvatar id={t.id} name={t.name} avatar={t.avatar} size="sm" /><span className="truncate text-sm">{t.name}</span></Link><FollowButton trader={t} compact /></li>)}</ul><h2 className="text-lg">Following activity</h2>{query.isError && <button className="text-warning" onClick={() => void query.refetch()}>History could not load. Retry</button>}{query.isLoading ? <p role="status">Loading recorded trades…</p> : <TradeTable trades={trades} explorerBase={explorer} emptyTitle="No recorded trades for these traders yet." />}</>}
    <p className="text-xs text-muted">Updates arrive from covered live wallets and stored history. Imported trader snapshots are not continuous live coverage.</p></div>;
}
