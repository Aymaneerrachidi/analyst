"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
import { MarketCanvas } from "./market-canvas";
import { TraderAvatar } from "@/components/common/avatar";

export function TokenChart({ address, symbol, currentPrice, initialTrades = [] }: { address: string; symbol: string; currentPrice?: number | null; initialTrades?: AnalystTrade[] }) {
  const [window, setWindow] = useState<FlowWindow>("24h");
  const [mode, setMode] = useState<"price" | "flow">("price");
  const [markerScope, setMarkerScope] = useState("all");
  const [markerSide, setMarkerSide] = useState("all");
  const [minimum, setMinimum] = useState(0);
  const [selected, setSelected] = useState<AnalystTrade[]>([]);
  const tracking = useTracking();
  const stream = useTradeStream();
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
  const markerEnd = Math.max(query.dataUpdatedAt, ...initialTrades.map(t => Date.parse(t.timestamp)), ...stream.trades.map(t => Date.parse(t.timestamp)));
  const markerTrades = mergeLiveTrades(data?.markers ?? initialTrades, stream.trades.filter(t => t.token.address.toLowerCase() === address.toLowerCase()), 300)
    .filter(t => Date.parse(t.timestamp) >= markerEnd - span && Date.parse(t.timestamp) <= markerEnd && (markerScope === "all" || tracking.following.some(f => f.id === t.traderId.toLowerCase())) && (markerSide === "all" || t.side === markerSide) && (minimum === 0 || (t.amountUsd != null && t.amountUsd >= minimum)))
    .map(t => ({ ...t, trader: stream.traders.get(t.traderId) ?? t.trader }));
  const timelineEnd = Math.max(chartEnd, ...markerTrades.map(t => Date.parse(t.timestamp)));
  const timelineStart = Math.min(chartStart || timelineEnd, ...markerTrades.map(t => Date.parse(t.timestamp)));
  const timeline = groupMarkers(markerTrades, timelineStart, timelineEnd);

  const time = (value: number) => new Date(value).toLocaleString("en-US", { timeZone: "UTC", ...(window === "7d" ? { month: "short" as const, day: "numeric" as const } : { hour: "2-digit" as const, minute: "2-digit" as const, hour12: false }) }) + " UTC";
  const hasChart = view === "price" ? candles.length > 0 : activity.length > 0;
  const grid = <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />;
  const xAxis = <XAxis dataKey="t" type="number" domain={view === "price" ? chartTimeDomain(candles) : ["dataMin", "dataMax"]} tickFormatter={time} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={45} />;

  return (
    <section className="card min-w-0 overflow-hidden p-4 md:p-6" aria-label={`${symbol} chart`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-secondary">{view === "price" ? `${symbol} ${executions ? "execution prices" : "price"}` : "Tracked buy and sell volume"}</h2>
          <p className="mt-2 font-mono text-2xl tracking-[-0.04em] text-primary">{view === "price" ? last ? priceLabel(last.close) : currentPrice != null ? formatPrice(currentPrice) : query.isLoading ? "Loading history" : "Price unavailable" : data ? formatUsd(activity.reduce((sum, p) => sum + p.buyUsd + p.sellUsd, 0)) : "Loading flow"}<span className="ml-2 font-sans text-xs tracking-normal text-muted">{view === "price" ? last ? unit : currentPrice != null ? "Latest market quote · USD" : "" : "USD"}</span></p>
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
      <div className="mt-4 h-[350px] min-w-0 md:h-[460px]" aria-busy={query.isFetching}>
        {query.isLoading ? <Skeleton className="h-full w-full" /> : query.isError && !data ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-sm text-secondary"><p>The chart couldn’t load.</p><Button size="sm" onClick={() => void query.refetch()}>Retry chart</Button></div>
        ) : !hasChart ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-secondary">
            <p>{view === "price" ? "No price history is available for this window." : "No tracked trades in this window."}</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted">{view === "price" ? "Try a longer period or switch to tracked flow to see wallet activity." : "Try a longer period to include earlier activity."}</p>
            <Button size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh chart</Button>
          </div>
        ) : view === "price" ? (
          <MarketCanvas candles={candles} trades={markerTrades} executions={executions} unit={unit} resetKey={`${address}:${window}`} onSelect={setSelected} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={activity} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} accessibilityLayer>
              {grid}{xAxis}
              <YAxis orientation="right" width={65} tickFormatter={(n) => formatUsd(n)} tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "var(--surface-hover)" }} content={({ active, payload }) => {
                const point = payload?.[0]?.payload as TokenChartData["activity"][number] | undefined;
                return active && point ? <div className="rounded-xl border border-border bg-elevated p-3 text-xs shadow-lg"><p className="text-muted">{new Date(point.t).toLocaleString()}</p><p className="mt-2 text-neon">{point.buys} {point.buys === 1 ? "buy" : "buys"} · {formatUsd(point.buyUsd)}</p><p className="mt-1 text-negative">{point.sells} {point.sells === 1 ? "sell" : "sells"} · {formatUsd(point.sellUsd)}</p></div> : null;
              }} />
              <Bar dataKey="buyUsd" fill="#ccff00" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="sellUsd" fill="#ff7a81" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      {view === "price" && <div className="mt-4 border-t border-border pt-4"><div className="flex items-center justify-between text-xs"><p className="font-medium text-secondary">KOL activity <span className="ml-2 text-muted">{new Set(markerTrades.map(t => t.traderId)).size} wallets · {markerTrades.length} swaps</span></p><span className="text-muted">Select to inspect</span></div>{timeline.length ? <div className="mt-3 flex gap-2 overflow-x-auto pb-3" aria-label="Trade timeline">{[...timeline].reverse().map(g => <button key={g.id} aria-label={`Timeline ${g.trade.side} ${g.trade.trader.name}, ${g.trades.length} trades`} onClick={() => setSelected(g.trades)} className="flex min-w-[160px] shrink-0 items-center gap-2 rounded-xl border border-border bg-background p-3 text-left transition-colors hover:border-neon/40"><TraderAvatar name={g.trade.trader.name} id={g.trade.trader.id} avatar={g.trade.trader.avatar} size="xs" /><span className="min-w-0 text-[11px]"><span className="block max-w-28 truncate font-medium text-primary">{g.trade.trader.name}</span><span className={g.trade.side === "BUY" ? "text-neon" : "text-negative"}>{g.trade.side} {g.trades.length > 1 ? `×${g.trades.length}` : ""}</span><span className="ml-2 text-muted">{time(g.t)}</span></span></button>)}</div> : <p className="py-3 text-xs text-muted">No recorded swaps match these filters.</p>}<p className="text-[10px] leading-relaxed text-muted">Arrows mark trade timing on market candles, not execution prices. Details use recorded prices only. Up to 200 stored swaps plus incoming trades.</p></div>}
      {selected.length > 0 && <div className="mt-3 rounded-lg border border-border bg-elevated p-3" aria-label="Selected trades"><div className="flex justify-between text-xs"><span>{selected.length} selected trade{selected.length > 1 ? "s" : ""}</span><button onClick={() => setSelected([])}>Close details</button></div><ul className="mt-2 max-h-48 space-y-3 overflow-y-auto">{selected.map(t => <li key={t.id} className="flex flex-wrap items-center gap-2 text-xs"><TraderAvatar id={t.trader.id} name={t.trader.name} avatar={t.trader.avatar} size="xs" /><Link className="font-medium hover:text-neon" href={`/trader/${t.trader.id}`}>{t.trader.name}</Link><span className={t.side === "BUY" ? "text-neon" : "text-negative"}>{t.side}</span><span>{formatUsd(t.amountUsd)}</span><span className="text-muted">{executionPrice(t) == null ? "Execution price unavailable" : `${formatPrice(executionPrice(t))} USD`} · {new Date(t.timestamp).toLocaleString()}</span></li>)}</ul></div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-[11px] leading-relaxed text-muted"><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts? ? ? 2025 TradingView, Inc.</a>
        <p>{view === "price" ? executions ? "Prices paid in recorded swaps, up to the latest 1,000 executions. Partial wallet coverage; not a continuous market quote or OHLC history." : `Recorded prices in ${unit}. Gaps may reflect periods without trading.` : "USD volume from tracked wallets only. This is activity, not a price chart."}</p>
        {data?.marketUrl && <a href={data.marketUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-secondary hover:text-neon">{data.source === "pons" ? "Pons launchpad" : data.source === "dexpaprika" ? "DexPaprika" : "GeckoTerminal"} <ArrowUpRightIcon /></a>}
      </div>
      {query.isError && data && <p role="status" className="mt-3 text-xs text-warning">Refresh failed. Showing the last loaded chart. <button className="underline" onClick={() => void query.refetch()}>Retry refresh</button></p>}
      {candles.length === 1 && view === "price" && <p className="mt-3 text-xs text-secondary">One recorded price point is available. More history will appear as the source reports trades.</p>}
      {data?.error && <p role="status" className="mt-3 text-xs text-warning">{data.error}</p>}
      {data?.fdv != null && <p className="mt-3 text-xs text-muted">Fully diluted valuation <span className="text-secondary">{formatUsd(data.fdv)}</span> <span className="mx-2">·</span> Liquidity <span className="text-secondary">{formatUsd(data.liquidityUsd)}</span></p>}
    </section>
  );
}
