"use client";

import { useEffect, useRef, useState } from "react";
import { AreaSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from "lightweight-charts";
import type { AnalystTrade, TokenCandle } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import { groupMarkers } from "@/lib/chart-markers";

type Props = { candles: TokenCandle[]; trades: AnalystTrade[]; executions: boolean; unit: string; resetKey: string; onSelect: (trades: AnalystTrade[]) => void };

/** Market candles remain provider candles. Wallet arrows annotate their time,
 * never manufacture an execution price or a market candle from a wallet trade. */
export function MarketCanvas({ candles, trades, executions, unit, resetKey, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markers = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
  const selected = useRef(new Map<string, AnalystTrade[]>());
  const callback = useRef(onSelect);
  const fitted = useRef(false);
  const [style, setStyle] = useState<"candles" | "line">("candles");
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
      ? chart.addSeries(AreaSeries, { lineColor: "#ccff00", topColor: "#ccff0018", bottomColor: "#ccff0000", lineWidth: 2, priceLineVisible: false })
      : chart.addSeries(CandlestickSeries, { upColor: "#ccff00", downColor: "#ff7a81", wickUpColor: "#ccff00", wickDownColor: "#ff7a81", borderVisible: false, priceLineVisible: false });
    const histogram = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false });
    histogram.priceScale().applyOptions({ scaleMargins: { top: 0.83, bottom: 0 }, visible: false });
    const plugin = createSeriesMarkers(series, [], { autoScale: false });
    chart.subscribeClick(event => { const values = selected.current.get(String(event.hoveredObjectId)); if (values) callback.current(values); });
    chart.subscribeCrosshairMove(event => {
      const point = event.seriesData.get(series);
      if (!point) { setHover(""); return; }
      if ("close" in point) setHover(`O ${priceLabel(point.open)}   H ${priceLabel(point.high)}   L ${priceLabel(point.low)}   C ${priceLabel(point.close)} ${unit}`);
      else if ("value" in point) setHover(`${priceLabel(point.value)} ${unit}`);
    });
    api.current = chart; price.current = series; volume.current = histogram; markers.current = plugin; fitted.current = false;
    setReady(value => value + 1);
    return () => { plugin.detach(); chart.remove(); api.current = null; price.current = null; volume.current = null; markers.current = null; };
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
    const groups = groupMarkers(trades, rows[0][0] * 1000, (rows.at(-1)![0] + (rows.length > 1 ? rows.at(-1)![0] - rows.at(-2)![0] : 60)) * 1000, Math.min(48, rows.length));
    selected.current = new Map(groups.map(g => [g.id, g.trades]));
    markers.current?.setMarkers(groups.map(g => {
      const time = rows.reduce((previous, row) => row[0] <= g.t / 1000 ? row[0] : previous, rows[0][0]);
      return { time: time as UTCTimestamp, id: g.id, position: g.trade.side === "BUY" ? "belowBar" as const : "aboveBar" as const, shape: g.trade.side === "BUY" ? "arrowUp" as const : "arrowDown" as const, color: g.trade.side === "BUY" ? "#ccff00" : "#ff7a81", text: `${g.trade.trader.name.slice(0, 12)}${g.trades.length > 1 ? ` +${g.trades.length - 1}` : ""}`, size: 1 };
    }).sort((a, b) => Number(a.time) - Number(b.time)));
    if (!fitted.current) { api.current.timeScale().fitContent(); fitted.current = true; }
  }, [candles, trades, executions, style, ready]);

  return <div className="relative h-full rounded-xl border border-border bg-[#0b100d]">
    <div className="absolute inset-x-3 top-2 z-10 flex items-center justify-between gap-2 text-[10px]">
      <span className="pointer-events-none truncate font-mono text-secondary">{hover || `${candles.length} observations · ${unit} · drag to explore`}</span>
      <div className="flex shrink-0 gap-1 rounded-md border border-border bg-background p-1">
        {!executions && <button className="rounded px-2 py-1 text-secondary hover:text-neon" onClick={() => setStyle(v => v === "candles" ? "line" : "candles")}>{style === "candles" ? "Line" : "Candles"}</button>}
        <button aria-label="Fit chart" className="rounded px-2 py-1 text-secondary hover:text-neon" onClick={() => api.current?.timeScale().fitContent()}>Fit</button>
      </div>
    </div>
    <div ref={host} className="h-full w-full" role="img" aria-label={`${executions ? "Execution price" : style === "candles" ? "Candlestick" : "Price"} chart with KOL buy and sell annotations`} />
  </div>;
}
