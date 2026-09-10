"use client";

import { useEffect, useRef, useState } from "react";
import { AreaSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { AnalystTrade, TokenCandle } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import { TraderAvatar } from "@/components/common/avatar";
import { groupMarkers } from "@/lib/chart-markers";

type Props = { candles: TokenCandle[]; trades: AnalystTrade[]; executions: boolean; unit: string; resetKey: string; onSelect: (trades: AnalystTrade[]) => void };

/** Market candles remain provider candles. Wallet arrows annotate their time,
 * never manufacture an execution price or a market candle from a wallet trade. */
export function MarketCanvas({ candles, trades, executions, unit, resetKey, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const redraw = useRef<() => void>(() => {});
  const [pins, setPins] = useState<{ id: string; x: number; y: number; trades: AnalystTrade[] }[]>([]);
  const callback = useRef(onSelect);
  const fitted = useRef(false);
  const [style, setStyle] = useState<"candles" | "line">("candles");
  const [names, setNames] = useState(true);
  const [hover, setHover] = useState<string>("");
  const [ready, setReady] = useState(0);
  useEffect(() => { callback.current = onSelect; }, [onSelect]);

  useEffect(() => {
    if (!host.current) return;
    const priceLabel = (value: number) => unit === "USD" ? formatPrice(value) : formatPrice(value).replace(/^\$/, "");
    const chart = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#0b100d" }, textColor: "#8b998f", fontFamily: "ui-monospace, monospace", fontSize: 11, attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: "#1b241e" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.16, bottom: 0.23 } },
      timeScale: { borderColor: "#233027", timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 7 },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      localization: { priceFormatter: (value: number) => unit === "USD" ? formatPrice(value) : formatPrice(value).replace(/^\$/, "") },
    });
    const series = executions || style === "line"
      ? chart.addSeries(AreaSeries, { lineColor: "#ccff00", topColor: "#ccff0018", bottomColor: "#ccff0000", lineWidth: 2, pointMarkersVisible: executions, pointMarkersRadius: 3, priceLineVisible: false, priceFormat: { type: "price", precision: 12, minMove: 0.000000000001 } })
      : chart.addSeries(CandlestickSeries, { upColor: "#ccff00", downColor: "#ff7a81", wickUpColor: "#ccff00", wickDownColor: "#ff7a81", borderVisible: false, priceLineVisible: false, priceFormat: { type: "price", precision: 12, minMove: 0.000000000001 } });
    const histogram = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false });
    histogram.priceScale().applyOptions({ scaleMargins: { top: 0.83, bottom: 0 }, visible: false });
    const updatePins = () => redraw.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(updatePins);
    const observer = new ResizeObserver(updatePins);
    observer.observe(host.current);
    chart.subscribeCrosshairMove(event => {
      const point = event.seriesData.get(series);
      if (!point) { setHover(""); return; }
      if ("close" in point) setHover(`O ${priceLabel(point.open)}   H ${priceLabel(point.high)}   L ${priceLabel(point.low)}   C ${priceLabel(point.close)} ${unit}`);
      else if ("value" in point) setHover(`${priceLabel(point.value)} ${unit}`);
    });
    api.current = chart; price.current = series; volume.current = histogram; fitted.current = false;
    setReady(value => value + 1);
    return () => { observer.disconnect(); chart.timeScale().unsubscribeVisibleLogicalRangeChange(updatePins); chart.remove(); api.current = null; price.current = null; volume.current = null; };
  }, [style, executions, unit, resetKey]);

  useEffect(() => {
    if (!price.current || !api.current || !volume.current) return;
    const unique = new Map<number, TokenCandle>();
    for (const candle of candles) if (Number.isFinite(candle.t) && candle.close > 0 && Number.isFinite(candle.close)) unique.set(Math.floor(candle.t / 1000), candle);
    const rows = [...unique].sort((a, b) => a[0] - b[0]);
    if (!rows.length) return;
    if (executions || style === "line") (price.current as ISeriesApi<"Area">).setData(rows.map(([time, c]) => ({ time: time as UTCTimestamp, value: c.close })));
    else (price.current as ISeriesApi<"Candlestick">).setData(rows.map(([time, c]) => ({ time: time as UTCTimestamp, open: c.open ?? c.close, high: Math.max(c.high ?? c.close, c.open ?? c.close, c.close), low: Math.min(c.low ?? c.close, c.open ?? c.close, c.close), close: c.close })));
    volume.current.setData(rows.map(([time, c]) => ({ time: time as UTCTimestamp, value: Math.max(0, c.volume || 0), color: c.close >= (c.open ?? c.close) ? "#ccff0035" : "#ff7a8135" })));
    const groups = groupMarkers(trades, rows[0][0] * 1000, (rows.at(-1)![0] + (rows.length > 1 ? rows.at(-1)![0] - rows.at(-2)![0] : 60)) * 1000, Math.min(24, rows.length));
    const updatePins = () => {
      if (!api.current || !price.current || !host.current) return;
      const width = host.current.clientWidth - 76, height = host.current.clientHeight - 42;
      const visible: { id: string; x: number; y: number; trades: AnalystTrade[] }[] = [];
      for (const group of groups) {
        const row = rows.reduce((previous, row) => row[0] <= group.t / 1000 ? row : previous, rows[0]);
        const x = api.current.timeScale().timeToCoordinate(row[0] as UTCTimestamp);
        const buy = group.trade.side === 'BUY';
        const y = price.current.priceToCoordinate(buy ? row[1].low ?? row[1].close : row[1].high ?? row[1].close);
        if (x == null || y == null || x < 18 || x > width || y < 32 || y > height) continue;
        const neighbor = visible.find(p => p.trades[0].side === group.trade.side && Math.abs(p.x - x) < 38);
        if (neighbor) { neighbor.trades.push(...group.trades); continue; }
        visible.push({ id: group.id, x, y: Math.max(46, Math.min(height - 18, y + (buy ? 26 : -26))), trades: [...group.trades] });
      }
      setPins(visible);
    };
    redraw.current = updatePins;
    if (!fitted.current) { api.current.timeScale().fitContent(); fitted.current = true; }
    const frame = requestAnimationFrame(updatePins);
    return () => { cancelAnimationFrame(frame); redraw.current = () => {}; };

  }, [candles, trades, executions, style, ready, names]);

  return <div className="relative h-full rounded-xl border border-border bg-[#0b100d]">
    <div className="absolute inset-x-3 top-2 z-10 flex items-center justify-between gap-2 text-[10px]">
      <span className="pointer-events-none truncate font-mono text-secondary">{hover || `${candles.length} observations · ${unit} · drag to explore`}</span>
      <div className="flex shrink-0 gap-1 rounded-md border border-border bg-background p-1">
        <button aria-label="Show wallet markers on chart" aria-pressed={names} className={`rounded px-2 py-1 ${names ? "text-neon" : "text-secondary"} hover:text-neon`} onClick={() => setNames(value => !value)}>KOLs</button>
        {!executions && <button className="rounded px-2 py-1 text-secondary hover:text-neon" onClick={() => setStyle(v => v === "candles" ? "line" : "candles")}>{style === "candles" ? "Line" : "Candles"}</button>}
        <button aria-label="Fit chart" className="rounded px-2 py-1 text-secondary hover:text-neon" onClick={() => api.current?.timeScale().fitContent()}>Fit</button>
      </div>
    </div>
    {names && <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-label="Wallet trade markers">{pins.map(pin => {
      const trade = pin.trades.at(-1)!;
      return <button key={pin.id} onClick={() => callback.current(pin.trades)} style={{ left: pin.x, top: pin.y }} className={`pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-background shadow-sm transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neon ${trade.side === 'BUY' ? 'border-neon' : 'border-negative'}`} aria-label={`${trade.trader.name} ${trade.side.toLowerCase()}${pin.trades.length > 1 ? ` and ${pin.trades.length - 1} more trades` : ''}`} title={`${trade.trader.name} · ${trade.side} · ${pin.trades.length} trade${pin.trades.length > 1 ? 's' : ''}`}>
        {trade.trader.avatar ? <TraderAvatar name={trade.trader.name} id={trade.traderId} avatar={trade.trader.avatar} size="xs"/> : <span className={`text-[10px] font-bold ${trade.side === 'BUY' ? 'text-neon' : 'text-negative'}`}>{trade.side === 'BUY' ? 'B' : 'S'}</span>}
        {pin.trades.length > 1 && <span className="absolute -right-2 -top-2 rounded-full border border-border bg-background px-1 text-[9px] text-primary">{pin.trades.length}</span>}
      </button>;
    })}</div>}
    <div ref={host} className="h-full w-full" role="img" aria-label={`${executions ? "Execution price" : style === "candles" ? "Candlestick" : "Price"} chart with KOL buy and sell annotations`} />
  </div>;
}
