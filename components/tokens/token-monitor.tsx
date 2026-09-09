"use client";
import { useQuery } from "@tanstack/react-query";
import type { AnalystToken, FlowWindow } from "@/lib/types";
import { TokenTable } from "./token-table";
import { useFreshness } from "@/components/shell/live-indicator";
import { apiGet } from "@/lib/client/fetcher";

export function TokenMonitor({ initial, tab, window, page, query, category }: { category: string; initial: AnalystToken[]; tab: string; window: FlowWindow; page: number; query: string }) {
  const { data: freshness } = useFreshness();
  const params = new URLSearchParams({ category, tab, window, limit: "100", offset: String((page - 1) * 100), q: query });
  const { data, isError, refetch } = useQuery({ queryKey: ["token-monitor", tab, window, page, query, category], queryFn: ({ signal }) => apiGet<{ tokens: AnalystToken[] }>(`/api/tokens?${params}`, signal), initialData: { tokens: initial }, staleTime: 10_000, refetchInterval: 20_000 });
  return <div>{freshness?.provider === "kolhood" && freshness.tradeAgeMs != null && freshness.tradeAgeMs > 600000 && <p role="status" className="mb-3 rounded-lg border border-warning/30 p-3 text-sm text-warning">The trade source has not advanced recently. Latest recorded trade: {freshness.lastTradeAt}. Stored tokens and market quotes remain available; use the 7-day window for older tracked activity.</p>}<p className="mb-3 text-xs text-muted">Last received market quotes. Refreshes every 20 seconds. FDV is fully diluted value.</p>{isError && <p role="status" className="mb-3 text-sm text-secondary">Refresh interrupted. Showing the last received data. <button className="text-neon underline" onClick={() => void refetch()}>Retry</button></p>}<TokenTable tokens={data.tokens} emptyTitle={query ? `No tokens match “${query}”.` : undefined} /></div>;
}
