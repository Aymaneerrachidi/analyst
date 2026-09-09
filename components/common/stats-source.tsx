import type { AnalystTrader } from "@/lib/types";
export function StatsSource({ trader }: { trader: Pick<AnalystTrader, "statsSource" | "statsPeriod" | "statsUpdatedAt"> }) {
  return <span className="block text-[10px] font-normal uppercase tracking-wide text-muted" title={trader.statsUpdatedAt ? `Snapshot captured ${trader.statsUpdatedAt}` : "Snapshot date unavailable"}>{(trader.statsPeriod ?? "30d").toUpperCase()}{trader.statsUpdatedAt ? ` · ${trader.statsUpdatedAt.slice(0, 10)}` : ""}</span>;
}
