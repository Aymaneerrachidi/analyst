"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/client/fetcher";
import type { Freshness } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import { useTradeStream } from "@/components/live/stream-provider";

export function useFreshness(initial?: Freshness) {
  return useQuery({
    queryKey: ["freshness"],
    queryFn: () => apiGet<Freshness>("/api/freshness"),
    initialData: initial,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

const LABELS = {
  live: { text: "LIVE", dot: "bg-neon", textClass: "text-neon", animate: true },
  delayed: { text: "DELAYED", dot: "bg-warning", textClass: "text-warning", animate: false },
  offline: { text: "OFFLINE", dot: "bg-muted", textClass: "text-muted", animate: false },
  connecting: { text: "CONNECTING", dot: "bg-warning", textClass: "text-warning", animate: false },
  reconnecting: { text: "RECONNECTING", dot: "bg-warning", textClass: "text-warning", animate: false },
} as const;

export function LiveIndicator({
  initial,
  showTracked,
  size = "sm",
  className,
}: {
  initial?: Freshness;
  showTracked?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const { data } = useFreshness(initial);
  const stream = useTradeStream();
  const status = stream.enabled ? stream.status : data?.status ?? "offline";
  const meta = LABELS[status];
  const ageSec = data?.ageMs !== null && data?.ageMs !== undefined ? Math.round(data.ageMs / 1000) : null;
  const tip =
    stream.enabled ? (status === "live" ? "Connected to KOLHOOD's live trade stream. Trades appear as the source broadcasts them; analytics sync separately." : "Reconnecting to the live source. Saved trades remain visible.") : status === "live"
      ? `Feed synced ${ageSec ?? 0}s ago from ${data?.provider ?? "provider"}.`
      : status === "delayed"
        ? `Last successful sync was ${ageSec ?? "?"}s ago. Data may be stale.`
        : "No successful sync yet.";

  return (
    <Tip content={tip}>
      <span className={cn("inline-flex items-center gap-2 font-semibold tracking-[0.12em] tnum", size === "sm" ? "text-[11px]" : "text-xs", meta.textClass, className)}>
        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", meta.dot, meta.animate && "animate-live-dot")} aria-hidden />
        <span>{meta.text}</span>
        {showTracked && data && data.trackedTraders > 0 && (
          <span className="font-medium tracking-[0.12em] text-muted">· {data.trackedTraders} TRACKED TRADERS</span>
        )}
        {data?.isMock && (
          <span className="rounded border border-warning/40 px-1.5 py-px text-[10px] font-semibold tracking-[0.1em] text-warning" title="Synthetic development data. Not real market activity.">
            MOCK DATA
          </span>
        )}
      </span>
    </Tip>
  );
}
