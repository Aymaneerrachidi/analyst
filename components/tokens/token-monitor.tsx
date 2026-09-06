"use client";
import { useQuery } from "@tanstack/react-query";
import type { AnalystToken, FlowWindow } from "@/lib/types";
import { TokenTable } from "./token-table";
import { apiGet } from "@/lib/client/fetcher";

export function TokenMonitor({ initial, tab, window, page, query }: { initial: AnalystToken[]; tab: string; window: FlowWindow; page: number; query: string }) {
  const params = new URLSearchParams({ tab, window, limit: "100", offset: String((page - 1) * 100), q: query });
  const { data, isError, refetch } = useQuery({ queryKey: ["token-monitor", tab, window, page, query], queryFn: ({ signal }) => apiGet<{ tokens: AnalystToken[] }>(`/api/tokens?${params}`, signal), initialData: { tokens: initial }, staleTime: 10_000, refetchInterval: 20_000 });
  return <div><p className="mb-3 text-xs text-muted">Last received market quotes. Refreshes every 20 seconds. FDV is fully diluted value.</p>{isError && <p role="status" className="mb-3 text-sm text-secondary">Refresh interrupted. Showing the last received data. <button className="text-neon underline" onClick={() => void refetch()}>Retry</button></p>}<TokenTable tokens={data.tokens} emptyTitle={query ? `No tokens match “${query}”.` : undefined} /></div>;
}
