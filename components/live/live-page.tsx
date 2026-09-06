"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/client/fetcher";
import type { AnalystTrade, AnalystTrader } from "@/lib/types";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { LiveTradesFeed } from "@/components/trades/trade-table";

type Filter = "all" | "buys" | "sells" | "large" | "top";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "buys", label: "Buys" },
  { value: "sells", label: "Sells" },
  { value: "large", label: "Large" },
  { value: "top", label: "Top traders" },
];

const MIN_SIZES = [
  { value: "", label: "Any size" },
  { value: "500", label: "$500+" },
  { value: "1000", label: "$1K+" },
  { value: "5000", label: "$5K+" },
  { value: "25000", label: "$25K+" },
];

const selectClass =
  "h-10 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-[13px] text-primary outline-none transition-colors hover:border-border-hover focus:border-neon";

export function LivePage({ initialTrades, explorerBase, initialTraders }: { initialTrades: AnalystTrade[]; explorerBase: string; initialTraders: AnalystTrader[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [minUsd, setMinUsd] = useState("");
  const [trader, setTrader] = useState("");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);

  const { data: traders } = useQuery({
    queryKey: ["traders", "all", "select"],
    queryFn: () => apiGet<{ traders: AnalystTrader[] }>("/api/traders?period=all&limit=200"),
    initialData: { traders: initialTraders },
    staleTime: 5 * 60_000,
  });

  const params = {
    filter: filter === "all" ? undefined : filter,
    minUsd: minUsd || undefined,
    trader: trader || undefined,
    q: query.trim() || undefined,
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs value={filter} onChange={setFilter} options={FILTERS} ariaLabel="Trade type" />
        <Button size="sm" onClick={() => setPaused((value) => !value)} aria-pressed={paused}>
          {paused ? <PlayIcon className="h-4 w-4" /> : <PauseIcon className="h-4 w-4" />}{paused ? "Resume updates" : "Pause updates"}
        </Button>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="flex min-w-0 flex-col gap-2 text-xs text-secondary">Trade size
          <select value={minUsd} onChange={(e) => setMinUsd(e.target.value)} className={selectClass} aria-label="Minimum trade size">
            {MIN_SIZES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-2 text-xs text-secondary">Trader
          <select value={trader} onChange={(e) => setTrader(e.target.value)} className={selectClass} aria-label="Trader">
            <option value="">All traders</option>
            {(traders?.traders ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex min-w-0 flex-col gap-2 text-xs text-secondary sm:col-span-1">Token
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol or address"
            aria-label="Filter by token"
            className={`${selectClass} placeholder:text-muted`}
          />
        </label>
      </div>
      <LiveTradesFeed
        initialTrades={initialTrades}
        params={params}
        limit={60}
        paused={paused}
        explorerBase={explorerBase}
        emptyTitle="No trades match these filters."
        emptyDescription="New trades will appear here the moment they match."
      />
    </div>
  );
}
