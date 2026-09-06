"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { apiGet } from "@/lib/client/fetcher";
import { formatPrice, formatUsd } from "@/lib/format";
import { FLOW_WINDOWS, type FlowWindow } from "@/lib/providers/types";
import type { TokenChartData } from "@/lib/types";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function TokenChart({ address, symbol }: { address: string; symbol: string }) {
  const [window, setWindow] = useState<FlowWindow>("24h");
  const [mode, setMode] = useState<"price" | "flow">("price");
  const gradient = useId().replace(/:/g, "");
  const query = useQuery({
    queryKey: ["token-chart", address, window],
    queryFn: ({ signal }) => apiGet<TokenChartData>(`/api/tokens/${encodeURIComponent(address)}/chart?window=${window}`, signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const data = query.data;
  const unit = data?.priceUnit ?? "USD";
  const priceLabel = (value: number | null | undefined) => unit === "USD" ? formatPrice(value) : formatPrice(value).replace(/^\$/, "");
  const view = mode;
  const candles = data?.candles ?? [];
  const activity = data?.activity ?? [];
  const last = candles.at(-1);
  const time = (value: number) => new Date(value).toLocaleString(undefined, window === "7d" ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" });
  const hasChart = view === "price" ? candles.length > 0 : activity.length > 0;
  const grid = <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />;
  const xAxis = <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={time} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={45} />;

  return (
    <section className="card min-w-0 overflow-hidden p-4 md:p-6" aria-label={`${symbol} chart`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-secondary">{view === "price" ? `${symbol} price` : "Tracked buy and sell volume"}</h2>
          <p className="mt-2 font-mono text-2xl tracking-[-0.04em] text-primary">{view === "price" ? priceLabel(last?.close) : formatUsd(data ? activity.reduce((sum, p) => sum + p.buyUsd + p.sellUsd, 0) : null)}<span className="ml-2 font-sans text-xs tracking-normal text-muted">{view === "price" ? unit : "USD"}</span></p>
        </div>
        <FilterTabs size="sm" value={window} onChange={setWindow} options={FLOW_WINDOWS.map((value) => ({ value, label: value.toUpperCase() }))} ariaLabel="Token chart period" />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs size="sm" value={view} onChange={setMode} options={[{ value: "price", label: "Price" }, { value: "flow", label: "Tracked flow" }]} ariaLabel="Chart view" />
        {view === "flow" && <p className="inline-flex gap-4 text-[11px]"><span className="text-neon">Buys</span><span className="text-negative">Sells</span></p>}
        {data?.source === "mock" && <span className="text-[11px] text-warning">Synthetic demo data</span>}
      </div>
      <div className="mt-4 h-[300px] min-w-0 md:h-[380px]" aria-busy={query.isFetching}>
        {query.isLoading ? <Skeleton className="h-full w-full" /> : query.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-sm text-secondary"><p>The chart couldn’t load.</p><Button size="sm" onClick={() => void query.refetch()}>Retry chart</Button></div>
        ) : !hasChart ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-secondary">
            <p>{view === "price" ? "No price history is available for this window." : "No tracked trades in this window."}</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted">{view === "price" ? "Try a longer period or switch to tracked flow to see wallet activity." : "Try a longer period to include earlier activity."}</p>
            <Button size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh chart</Button>
          </div>
        ) : view === "price" ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={candles} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} accessibilityLayer>
              <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ccff00" stopOpacity={0.18} /><stop offset="100%" stopColor="#ccff00" stopOpacity={0} /></linearGradient></defs>
              {grid}{xAxis}
              <YAxis orientation="right" width={78} domain={["auto", "auto"]} tickFormatter={(n) => priceLabel(n)} tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={({ active, payload }) => {
                const point = payload?.[0]?.payload as TokenChartData["candles"][number] | undefined;
                return active && point ? <div className="rounded-xl border border-border bg-elevated p-3 text-xs shadow-lg"><p className="text-muted">{new Date(point.t).toLocaleString()}</p><p className="mt-1 font-mono text-neon">{priceLabel(point.close)} {unit}</p>{data?.source !== "pons" && <p className="mt-2 text-secondary">High {priceLabel(point.high)} · Low {priceLabel(point.low)}</p>}<p className="mt-1 text-muted">Volume {unit === "USD" ? formatUsd(point.volume) : `${point.volume.toLocaleString()} ${unit}`}</p></div> : null;
              }} />
              <Area type="linear" dataKey="close" stroke="#ccff00" strokeWidth={2} fill={`url(#${gradient})`} isAnimationActive={false} dot={candles.length === 1 ? { r: 4, fill: "#ccff00" } : false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={activity} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} accessibilityLayer>
              {grid}{xAxis}
              <YAxis orientation="right" width={65} tickFormatter={(n) => formatUsd(n)} tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "var(--surface-hover)" }} content={({ active, payload }) => {
                const point = payload?.[0]?.payload as TokenChartData["activity"][number] | undefined;
                return active && point ? <div className="rounded-xl border border-border bg-elevated p-3 text-xs shadow-lg"><p className="text-muted">{new Date(point.t).toLocaleString()}</p><p className="mt-2 text-neon">{point.buys} buys · {formatUsd(point.buyUsd)}</p><p className="mt-1 text-negative">{point.sells} sells · {formatUsd(point.sellUsd)}</p></div> : null;
              }} />
              <Bar dataKey="buyUsd" fill="#ccff00" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="sellUsd" fill="#ff7a81" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-[11px] leading-relaxed text-muted">
        <p>{view === "price" ? `Recorded prices in ${unit}. Gaps may reflect periods without trading.` : "USD volume from tracked wallets only. This is activity, not a price chart."}</p>
        {data?.marketUrl && <a href={data.marketUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-secondary hover:text-neon">{data.source === "pons" ? "Pons launchpad" : "GeckoTerminal"} <ArrowUpRightIcon /></a>}
      </div>
      {data?.error && <p role="status" className="mt-3 text-xs text-warning">{data.error}</p>}
      {data?.fdv != null && <p className="mt-3 text-xs text-muted">Fully diluted valuation <span className="text-secondary">{formatUsd(data.fdv)}</span> <span className="mx-2">·</span> Liquidity <span className="text-secondary">{formatUsd(data.liquidityUsd)}</span></p>}
    </section>
  );
}
