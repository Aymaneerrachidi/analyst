"use client";
import { useId, useState } from "react";
import type { AnalystTrade } from "@/lib/types";
export function ChartMarker({ cx = 0, cy = 0, trade, count, onSelect }: { cx?: number; cy?: number; trade: AnalystTrade; count: number; onSelect: () => void }) {
  const clip = useId().replace(/:/g, "");
  const [failed, setFailed] = useState(false);
  const source = trade.trader.avatar;
  const avatar = source?.startsWith("https://") ? `/api/image?src=${encodeURIComponent(source)}` : source?.startsWith("/") && !source.startsWith("//") ? source : null;
  const color = trade.side === "BUY" ? "#ccff00" : "#ff7a81";
  return <g transform={`translate(${cx},${cy})`} role="button" tabIndex={0} aria-label={`${trade.side} ${trade.trader.name}${count > 1 ? ` and ${count - 1} nearby trades` : ""}`} onClick={onSelect} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }} className="cursor-pointer outline-neon">
    <title>{trade.trader.name} · {trade.side} · {count} trade{count === 1 ? "" : "s"}</title>
    <circle r={14} fill="#101510" stroke={color} strokeWidth={2} />
    {avatar && !failed ? <><defs><clipPath id={clip}><circle r={11} /></clipPath></defs><image href={avatar} x={-11} y={-11} width={22} height={22} clipPath={`url(#${clip})`} onError={() => setFailed(true)} /></> : <text textAnchor="middle" dy="4" fontSize={11} fill={color}>{trade.side === "BUY" ? "B" : "S"}</text>}
    {count > 1 && <><circle cx={12} cy={-11} r={8} fill={color} /><text x={12} y={-8} textAnchor="middle" fontSize={9} fill="#080b09">{count}</text></>}
  </g>;
}
