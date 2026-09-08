"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { apiGet } from "@/lib/client/fetcher";
import { formatUsdSigned } from "@/lib/format";
import type { PnlPoint, RankingPeriod } from "@/lib/types";
import { FilterTabs } from "@/components/ui/filter-tabs";
export function PnlChart({ traderId, initialSeries, initialPeriod = "30d" }: { traderId: string; initialSeries: PnlPoint[]; initialPeriod?: RankingPeriod }) {
  const [period, setPeriod] = useState<RankingPeriod>(initialPeriod);
  const query = useQuery({ queryKey: ["trader-series", traderId, period], queryFn: ({ signal }) => apiGet<{ series: PnlPoint[] }>(`/api/traders/${traderId}?period=${period}`, signal), initialData: period === initialPeriod ? { series: initialSeries } : undefined, staleTime: 30_000 });
  const series = query.data?.series ?? [];
  const last = series.at(-1)?.value;
  const color = (last ?? 0) >= 0 ? "#CCFF00" : "#FF7A81";
  return <div className="card p-4 md:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="label-caps">Analyst tracked PnL · {period.toUpperCase()}</p><p className="mt-1 text-2xl font-semibold tnum" style={{ color }}>{last == null ? "No covered sells" : formatUsdSigned(last)}</p></div><FilterTabs size="sm" value={period} onChange={setPeriod} options={(["24h", "7d", "30d", "all"] as RankingPeriod[]).map(value => ({ value, label: value.toUpperCase() }))} ariaLabel="Chart period" /></div>
    <p className="mt-2 text-xs text-muted">ANALYST TRACKED · PARTIAL HISTORY · {period.toUpperCase()}</p>
    {query.isError && <button onClick={() => void query.refetch()} className="mt-3 text-xs text-warning">Refresh failed. Retry tracked PnL</button>}
    <div className="mt-4 h-44">{query.isLoading ? <p role="status" className="text-sm text-muted">Loading tracked sells…</p> : !series.length ? <p className="text-sm text-muted">No sells with known realized PnL in this window. Source ranking totals are shown separately above.</p> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={series}><YAxis hide domain={["auto", "auto"]} /><Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.t ? new Date(payload[0].payload.t).toLocaleString() : ""} formatter={(value) => formatUsdSigned(Number(value))} contentStyle={{ background: "var(--surface)", borderColor: "var(--border)", fontSize: 12 }} /><Area type="linear" dataKey="value" stroke={color} fill={color} fillOpacity={0.12} isAnimationActive={false} /></AreaChart></ResponsiveContainer>}</div>
    <p className="mt-3 text-xs leading-relaxed text-muted">Cumulative PnL from recorded sells with a known cost basis. Missing trade history and unknown PnL are excluded, not treated as zero. This is not the source-reported ranking PnL.</p>
  </div>;
}
