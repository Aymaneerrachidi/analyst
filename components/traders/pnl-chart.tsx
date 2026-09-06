"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { apiGet } from "@/lib/client/fetcher";
import { formatUsd, formatUsdSigned } from "@/lib/format";
import type { AnalystTrader, PnlPoint, RankingPeriod, TraderTokenPosition } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Skeleton } from "@/components/ui/skeleton";

interface Response {
  trader: AnalystTrader;
  series: PnlPoint[];
  positions: TraderTokenPosition[];
  period: RankingPeriod;
}

const OPTIONS: { value: RankingPeriod; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "ALL" },
];

export function PnlChart({
  traderId,
  initialSeries,
  initialPeriod = "30d",
  periodPnl,
}: {
  traderId: string;
  initialSeries: PnlPoint[];
  initialPeriod?: RankingPeriod;
  /** Realized PnL per period from the data source; used when trade-level PnL is unavailable. */
  periodPnl?: Partial<Record<RankingPeriod, number | null | undefined>>;
}) {
  const [period, setPeriod] = useState<RankingPeriod>(initialPeriod);
  const { data, isFetching } = useQuery({
    queryKey: ["trader-series", traderId, period],
    queryFn: () => apiGet<Response>(`/api/traders/${traderId}?period=${period}`),
    initialData: period === initialPeriod ? ({ series: initialSeries, period } as Response) : undefined,
    staleTime: 30_000,
  });
  const series = data?.series ?? [];
  const hasData = series.some((p) => p.value !== 0);
  const fallback = periodPnl?.[period];
  const last = hasData ? (series[series.length - 1]?.value ?? null) : (fallback ?? null);
  const positive = (last ?? 0) >= 0;
  const color = positive ? "#CCFF00" : "#FF7A81";
  const periodValues = OPTIONS.map((o) => ({ ...o, value: periodPnl?.[o.value] ?? null }));
  const hasPeriodValues = periodValues.some((p) => p.value !== null && p.value !== 0);
  const maxAbs = Math.max(...periodValues.map((p) => Math.abs(p.value ?? 0)), 1);

  return (
    <div className="card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-caps">Realized PnL · {period.toUpperCase()}</p>
          <p className={cn("mt-1 text-2xl font-semibold tracking-tight tnum", positive ? "text-positive" : "text-negative")}>{formatUsdSigned(last)}</p>
        </div>
        <FilterTabs size="sm" value={period} onChange={setPeriod} options={OPTIONS} ariaLabel="Chart period" />
      </div>
      <div className={cn("mt-4 h-44 w-full transition-opacity", isFetching && "opacity-60")}>
        {series.length === 0 && isFetching ? (
          <Skeleton className="h-full w-full" />
        ) : !hasData && hasPeriodValues ? (
          <div className="flex h-full items-end gap-3 px-2 pb-1" role="img" aria-label="Realized PnL by period">
            {periodValues.map((p) => {
              const v = p.value ?? 0;
              const h = Math.max(4, (Math.abs(v) / maxAbs) * 100);
              return (
                <div key={p.label} className="flex h-full flex-1 flex-col justify-end">
                  <span className={cn("mb-1 text-center text-xs font-medium tnum", v >= 0 ? "text-positive" : "text-negative")}>{formatUsdSigned(v)}</span>
                  <div className={cn("w-full rounded-t-md", v >= 0 ? "bg-neon/70" : "bg-negative/70", period === p.label.toLowerCase() && "ring-1 ring-white/30")} style={{ height: `${h}%` }} />
                  <span className="mt-1.5 text-center text-[11px] text-muted">{p.label}</span>
                </div>
              );
            })}
          </div>
        ) : !hasData ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">No realized trades in this window.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`pnl-${traderId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                cursor={{ stroke: "rgba(255,255,255,0.15)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as PnlPoint;
                  return (
                    <div className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs shadow-xl">
                      <p className="text-muted">{new Date(p.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                      <p className={cn("font-medium tnum", p.value >= 0 ? "text-positive" : "text-negative")}>{formatUsdSigned(p.value)}</p>
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.75} fill={`url(#pnl-${traderId})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {hasData
          ? `Cumulative realized PnL from tracked sells, average-cost basis. Buys without a later sell are not counted. Peak ${formatUsd(Math.max(...series.map((p) => p.value), 0))}.`
          : "Realized PnL by period as reported by the data source. Trade-level attribution needs token amounts, which this source does not expose."}
      </p>
    </div>
  );
}
