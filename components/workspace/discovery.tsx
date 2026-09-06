"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Star, Radio, Search } from "lucide-react";
import { apiGet } from "@/lib/client/fetcher";
import { formatPrice, formatUsd } from "@/lib/format";
import type { AnalystToken, AnalystTrader } from "@/lib/types";
import { TokenAvatar, TraderAvatar } from "@/components/common/avatar";
import { PctDelta, MoneyDelta } from "@/components/common/metric";
import { useWatchlist } from "./watchlist";

export function DiscoveryPanel() {
  const pathname = usePathname();
  const [tab, setTab] = useState<"tokens" | "traders" | "watchlist">("tokens");
  const [search, setSearch] = useState("");
  const saved = useWatchlist();
  const query = useQuery<{ traders: AnalystTrader[] } | { tokens: AnalystToken[] }>({ queryKey: ["discovery", tab], queryFn: async ({ signal }) => tab === "traders"
    ? apiGet<{ traders: AnalystTrader[] }>("/api/traders?period=30d&limit=30", signal)
    : apiGet<{ tokens: AnalystToken[] }>("/api/tokens?window=24h&limit=40", signal), staleTime: 15_000, refetchInterval: 30_000 });
  const tokens = query.data && "tokens" in query.data ? query.data.tokens : [];
  const traders = query.data && "traders" in query.data ? query.data.traders : [];
  const needle = search.toLowerCase();
  const visibleTokens = (tab === "watchlist" ? saved : tokens).filter((t) => `${t.symbol} ${t.name} ${t.address}`.toLowerCase().includes(needle));
  return <aside className="discovery-panel" aria-label="Market discovery">
    <div className="flex items-center justify-between px-4 pb-3 pt-4"><span className="text-xs font-medium text-secondary">Discover</span><span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-neon">ROBINHOOD</span></div>
    <div className="mx-3 grid grid-cols-3 gap-1 border-b border-border pb-2">{([['tokens', 'Tokens'], ['traders', 'Traders'], ['watchlist', 'Saved']] as const).map(([value, label]) => <button key={value} aria-pressed={value === tab} onClick={() => setTab(value)} className={`min-h-9 rounded-md text-xs ${value === tab ? "bg-elevated text-neon" : "text-muted hover:text-primary"}`}>{label}</button>)}</div>
    <label className="mx-3 my-3 flex items-center gap-2 rounded-lg border border-border px-2.5"><Search className="h-3.5 w-3.5 text-muted" /><input className="h-8 min-w-0 w-full bg-transparent text-xs outline-none" aria-label="Search discovery" placeholder="Filter this list" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {query.isPending && tab !== "watchlist" && <p className="p-3 text-xs text-muted">Loading markets…</p>}
      {query.isError && tab !== "watchlist" && <button onClick={() => void query.refetch()} className="p-3 text-xs text-warning">Couldn’t load markets. Retry</button>}
      {tab === "traders" ? traders.filter((t) => `${t.name} ${t.wallet}`.toLowerCase().includes(needle)).map((t, i) => <Link key={t.id} href={`/trader/${t.id}`} className={`flex items-center gap-2 rounded-lg px-2 py-3 hover:bg-hover ${pathname.endsWith(t.id) ? "bg-elevated" : ""}`}><span className="w-3 text-[10px] text-muted">{i + 1}</span><TraderAvatar name={t.name} id={t.id} avatar={t.avatar} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{t.name}</span><span className="text-[10px] text-muted">30D realized</span></span><MoneyDelta value={t.realizedPnl} className="text-xs" /></Link>)
        : visibleTokens.map((t) => { const market = tokens.find((v) => v.address === t.address); return <Link key={t.address} href={`/token/${t.address}`} className={`flex items-center gap-2.5 rounded-lg px-2 py-3 hover:bg-hover ${pathname.endsWith(t.address) ? "bg-elevated ring-1 ring-border" : ""}`}><TokenAvatar symbol={t.symbol} address={t.address} image={t.image} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{t.symbol}</span><span className="text-[10px] text-muted">{market?.price != null ? formatPrice(market.price) : t.name}</span></span>{market && <span className="text-right"><span className="block text-[11px] text-secondary">{formatUsd(market.marketCap ?? market.fdv)}</span><PctDelta value={market.priceChange24h} className="text-[10px]" /></span>}</Link>; })}
      {tab === "watchlist" && !visibleTokens.length && <p className="px-3 py-5 text-xs leading-relaxed text-muted">Star tokens on their pages to save them here.</p>}
    </div>
    <div className="grid grid-cols-2 gap-2 border-t border-border p-3"><Link href="/live" className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-xs text-neon"><Radio className="h-3 w-3" />Live feed</Link><Link href="/watchlist" className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-xs text-secondary"><Star className="h-3 w-3" />Watchlist</Link></div>
    <Link href={tab === "traders" ? "/traders" : "/tokens"} className="flex items-center justify-between px-4 pb-4 text-[11px] text-muted">Explore all {tab === "traders" ? "traders" : "tokens"}<ArrowUpRight className="h-3 w-3" /></Link>
  </aside>;
}
