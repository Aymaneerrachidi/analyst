"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, ReferenceDot, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { apiGet } from "@/lib/client/fetcher";
import { formatPrice, formatUsd } from "@/lib/format";
import { FLOW_WINDOWS, type FlowWindow } from "@/lib/providers/types";
import type { AnalystTrade, TokenChartData } from "@/lib/types";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import Link from "next/link";
import { useTracking } from "@/lib/client/tracking-store";
import { useTradeStream } from "@/components/live/stream-provider";
import { mergeLiveTrades } from "@/lib/client/live-trades";
import { chartTimeDomain, liveExecutionSeries } from "@/lib/chart-series";
import { executionPrice, groupMarkers } from "@/lib/chart-markers";
import { ChartMarker } from "@/components/tracking/chart-marker";
import { TraderAvatar } from "@/components/common/avatar";

export function TokenChart({ address, symbol }: { address: string; symbol: string }) {
  const [window, setWindow] = useState<FlowWindow>("24h");
  const [mode, setMode] = useState<"price" | "flow">("price");
  const [markerScope, setMarkerScope] = useState("all");
  const [markerSide, setMarkerSide] = useState("all");
  const [minimum, setMinimum] = useState(0);
  const [selected, setSelected] = useState<AnalystTrade[]>([]);
  const tracking = useTracking();
  const stream = useTradeStream();
  const gradient = useId().replace(/:/g, "");
  const query = useQuery({
    queryKey: ["token-chart", address, window],
    queryFn: ({ signal }) => apiGet<TokenChartData>(`/api/tokens/${encodeURIComponent(address)}/chart?window=${window}`, AbortSignal.any([signal, AbortSignal.timeout(45_000)])),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
  const data = query.data;
  const executions = data?.source === "executions";
  const unit = data?.priceUnit ?? "USD";
  const priceLabel = (value: number | null | undefined) => unit === "USD" ? formatPrice(value) : formatPrice(value).replace(/^\$/, "");
  const view = mode;
  const tokenLive = stream.trades.filter(t => t.token.address.toLowerCase() === address.toLowerCase());
  const newestLive = tokenLive[0]?.timestamp;
  const lastRefresh = useRef(0);
  const refetch = query.refetch;
  useEffect(() => {
    if (!newestLive) return;
    const timer = setTimeout(() => { lastRefresh.current = Date.now(); void refetch(); }, Math.max(0, 5000 - (Date.now() - lastRefresh.current)));
    return () => clearTimeout(timer);
  }, [newestLive, refetch]);
  const candles = executions ? liveExecutionSeries(data?.candles ?? [], tokenLive, query.dataUpdatedAt - { "1h": 3_600_000, "6h": 21_600_000, "24h": 86_400_000, "7d": 604_800_000 }[window]) : data?.candles ?? [];
  const activity = data?.activity ?? [];
  const last = candles.at(-1);
  const chartEnd = candles.at(-1)?.t ?? 0;
  const chartStart = candles[0]?.t ?? 0;
  const span = { "1h": 3_600_000, "6h": 21_600_000, "24h": 86_400_000, "7d": 604_800_000 }[window];
  const markerEnd = Math.max(query.dataUpdatedAt, ...stream.trades.map(t => Date.parse(t.timestamp)));
  const markerTrades = mergeLiveTrades(data?.markers ?? [], stream.trades.filter(t => t.token.address.toLowerCase() === address.toLowerCase()), 300)
    .filter(t => Date.parse(t.timestamp) >= markerEnd - span && Date.parse(t.timestamp) <= markerEnd && (markerScope === "all" || tracking.following.some(f => f.id === t.traderId.toLowerCase())) && (markerSide === "all" || t.side === markerSide) && (minimum === 0 || (t.amountUsd != null && t.amountUsd >= minimum)))
    .map(t => ({ ...t, trader: stream.traders.get(t.traderId) ?? t.trader }));
  const groups = groupMarkers(markerTrades, chartStart, chartEnd);
  const timelineEnd = Math.max(chartEnd, ...markerTrades.map(t => Date.parse(t.timestamp)));
  const timelineStart = Math.min(chartStart || timelineEnd, ...markerTrades.map(t => Date.parse(t.timestamp)));
  const timeline = groupMarkers(markerTrades, timelineStart, timelineEnd);

  const time = (value: number) => new Date(value).toLocaleString(undefined, window === "7d" ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" });
  const hasChart = view === "price" ? candles.length > 0 : activity.length > 0;
  const grid = <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />;
  const xAxis = <XAxis dataKey="t" type="number" domain={view === "price" ? chartTimeDomain(candles) : ["dataMin", "dataMax"]} tickFormatter={time} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={45} />;

  return (
    <section className="card min-w-0 overflow-hidden p-4 md:p-6" aria-label={`${symbol} chart`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-secondary">{view === "price" ? `${symbol} ${executions ? "execution prices" : "price"}` : "Tracked buy and sell volume"}</h2>
          <p className="mt-2 font-mono text-2xl tracking-[-0.04em] text-primary">{view === "price" ? priceLabel(last?.close) : formatUsd(data ? activity.reduce((sum, p) => sum + p.buyUsd + p.sellUsd, 0) : null)}<span className="ml-2 font-sans text-xs tracking-normal text-muted">{view === "price" ? unit : "USD"}</span></p>
        </div>
        <FilterTabs size="sm" value={window} onChange={setWindow} options={FLOW_WINDOWS.map((value) => ({ value, label: value.toUpperCase() }))} ariaLabel="Token chart period" />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs size="sm" value={view} onChange={setMode} options={[{ value: "price", label: "Price" }, { value: "flow", label: "Tracked flow" }]} ariaLabel="Chart view" />
        {view === "flow" && <p className="inline-flex gap-4 text-[11px]"><span className="text-neon">Buys</span><span className="text-negative">Sells</span></p>}
        {data?.source === "mock" && <span className="text-[11px] text-warning">Synthetic demo data</span>}
        {executions && view === "price" && <span className="text-[11px] text-secondary">Recorded trades · USD</span>}
      </div>
      {view === "price" && <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-secondary"><span>Trade markers</span><label className="flex items-center gap-2"><span className="sr-only">Marker traders</span><select aria-label="Marker traders" className="rounded border border-border bg-surface p-2" value={markerScope} onChange={e => setMarkerScope(e.target.value)}><option value="all">All traders</option><option value="following">Following</option></select></label><select aria-label="Marker action" className="rounded border border-border bg-surface p-2" value={markerSide} onChange={e => setMarkerSide(e.target.value)}><option value="all">Buys & sells</option><option value="BUY">Buys</option><option value="SELL">Sells</option></select><select aria-label="Marker minimum value" className="rounded border border-border bg-surface p-2" value={minimum} onChange={e => setMinimum(Number(e.target.value))}><option value={0}>Any size</option><option value={1000}>$1,000+</option><option value={5000}>$5,000+</option></select></div>}
      <div className="mt-4 h-[300px] min-w-0 md:h-[380px]" aria-busy={query.isFetching}>
        {query.isLoading ? <Skeleton className="h-full w-full" /> : query.isError && !data ? (
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
                return active && point ? <div className="rounded-xl border border-border bg-elevated p-3 text-xs shadow-lg"><p className="text-muted">{new Date(point.t).toLocaleString()}</p><p className="mt-1 font-mono text-neon">{priceLabel(point.close)} {unit}</p>{point.high != null && point.low != null && <p className="mt-2 text-secondary">High {priceLabel(point.high)} · Low {priceLabel(point.low)}</p>}<p className="mt-1 text-muted">{executions ? "Trade value" : "Volume"} {unit === "USD" ? formatUsd(point.volume) : `${point.volume.toLocaleString()} ${unit}`}</p></div> : null;
              }} />
              <Area type="linear" dataKey="close" stroke="#ccff00" strokeWidth={2} fill={executions ? "transparent" : `url(#${gradient})`} isAnimationActive={false} dot={executions || candles.length === 1 ? { r: 2, fill: "#ccff00", strokeWidth: 0 } : false} />
              {unit === "USD" && groups.map(g => { const price = executionPrice(g.trade); return price == null ? null : <ReferenceDot key={g.id} x={g.t} y={price} ifOverflow="extendDomain" shape={props => <ChartMarker cx={props.cx} cy={props.cy} trade={g.trade} count={g.trades.length} onSelect={() => setSelected(g.trades)} />} />; })}
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
      {view === "price" && <div className="mt-3 border-t border-border pt-3"><p className="text-xs text-secondary">Trade timeline � {markerTrades.length} recent swaps � <span className="text-neon">Buy</span> / <span className="text-negative">Sell</span></p>{timeline.length ? <div className="relative mx-4 my-3 h-20 border-b border-border" aria-label="Trade timeline">{timeline.map(g => <button key={g.id} title={`${g.trade.trader.name} ${g.trade.side}`} aria-label={`Timeline ${g.trade.side} ${g.trade.trader.name}, ${g.trades.length} trades`} onClick={() => setSelected(g.trades)} className={`absolute flex h-8 min-w-8 -translate-x-1/2 items-center justify-center rounded-full border bg-background text-[10px] ${g.trade.side === "BUY" ? "top-0 border-neon text-neon" : "top-10 border-negative text-negative"}`} style={{ left: `${(g.t - timelineStart) / Math.max(1, timelineEnd - timelineStart) * 100}%` }}><TraderAvatar name={g.trade.trader.name} id={g.trade.trader.id} avatar={g.trade.trader.avatar} size="xs" /><span>{g.trades.length > 1 ? g.trades.length : g.trade.side === "BUY" ? "B" : "S"}</span></button>)}</div> : <p className="py-3 text-xs text-muted">No matching trades in this window.</p>}<p className="text-[11px] text-muted">Timeline shows timestamps, not prices. Price-chart markers require a known USD execution price and a USD chart. Nearby trades are grouped; select one for details. Up to 200 stored swaps plus incoming trades.</p></div>}
      {selected.length > 0 && <div className="mt-3 rounded-lg border border-border bg-elevated p-3" aria-label="Selected trades"><div className="flex justify-between text-xs"><span>{selected.length} selected trade{selected.length > 1 ? "s" : ""}</span><button onClick={() => setSelected([])}>Close details</button></div><ul className="mt-2 max-h-48 space-y-3 overflow-y-auto">{selected.map(t => <li key={t.id} className="flex flex-wrap items-center gap-2 text-xs"><TraderAvatar id={t.trader.id} name={t.trader.name} avatar={t.trader.avatar} size="xs" /><Link className="font-medium hover:text-neon" href={`/trader/${t.trader.id}`}>{t.trader.name}</Link><span className={t.side === "BUY" ? "text-neon" : "text-negative"}>{t.side}</span><span>{formatUsd(t.amountUsd)}</span><span className="text-muted">{executionPrice(t) == null ? "Execution price unavailable" : `${formatPrice(executionPrice(t))} USD`} � {new Date(t.timestamp).toLocaleString()}</span></li>)}</ul></div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-[11px] leading-relaxed text-muted">
        <p>{view === "price" ? executions ? "Prices paid in recorded swaps, up to the latest 1,000 executions. Partial wallet coverage; not a continuous market quote or OHLC history." : `Recorded prices in ${unit}. Gaps may reflect periods without trading.` : "USD volume from tracked wallets only. This is activity, not a price chart."}</p>
        {data?.marketUrl && <a href={data.marketUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-secondary hover:text-neon">{data.source === "pons" ? "Pons launchpad" : "GeckoTerminal"} <ArrowUpRightIcon /></a>}
      </div>
      {query.isError && data && <p role="status" className="mt-3 text-xs text-warning">Refresh failed. Showing the last loaded chart. <button className="underline" onClick={() => void query.refetch()}>Retry refresh</button></p>}
      {candles.length === 1 && view === "price" && <p className="mt-3 text-xs text-secondary">One recorded price point is available. More history will appear as the source reports trades.</p>}
      {data?.error && <p role="status" className="mt-3 text-xs text-warning">{data.error}</p>}
      {data?.fdv != null && <p className="mt-3 text-xs text-muted">Fully diluted valuation <span className="text-secondary">{formatUsd(data.fdv)}</span> <span className="mx-2">·</span> Liquidity <span className="text-secondary">{formatUsd(data.liquidityUsd)}</span></p>}
    </section>
  );
}
