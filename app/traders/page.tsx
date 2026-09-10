import type { Metadata } from "next";
import { ensureFresh } from "@/lib/services/sync";
import { listTraders, type TraderFilter } from "@/lib/services/intelligence";
import { RANKING_PERIODS, type RankingPeriod } from "@/lib/providers/types";
import { PageHeader } from "@/components/common/section-header";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { LiveLeaderboard } from "@/components/traders/live-leaderboard";
import { ComputedLeaderboard } from '@/components/intelligence/computed-leaderboard';

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Top Traders" };

const PERIOD_LABELS: Record<RankingPeriod, string> = { "24h": "Daily", "7d": "Weekly", "30d": "Monthly", all: "All time" };
const FILTERS: { value: TraderFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "memecoins", label: "Token history" },
  { value: "volume", label: "High volume" },
  { value: "active", label: "Most active" },
  { value: "winrate", label: "Best win rate" },
];

function href(period: RankingPeriod, filter: TraderFilter, q?: string, page = 1): string {
  const qs = new URLSearchParams();
  if (period !== "30d") qs.set("period", period);
  if (filter !== "all") qs.set("filter", filter);
  if (q) qs.set("q", q);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/traders?${s}` : "/traders";
}

export default async function TradersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const period = (RANKING_PERIODS.filter(p => p !== "all") as string[]).includes(String(sp.period)) ? (sp.period as RankingPeriod) : "30d";
  const filter = FILTERS.some((f) => f.value === sp.filter) ? (sp.filter as TraderFilter) : "all";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 40) : "";

  const page = Math.min(200, Math.max(1, Math.floor(Number(sp.page) || 1)));
  if (sp.source === 'analyst') return <ComputedLeaderboard period={period} query={q} sort={typeof sp.sort === 'string' ? sp.sort : 'quality'} minimum={Math.min(100000, Math.max(0, Number(sp.minimum) || 0))} page={page} />;
  await ensureFresh("trades", 8_000);
  const rows = await listTraders({ period, filter, limit: 26, offset: (page - 1) * 25, query: q });
  const traders = rows.slice(0, 25);
  const rankingState = await (await import("@/lib/services/external-rankings")).rankingStatus();

  return (
    <div>
      <PageHeader title="Follow the traders." description="Compare tracked wallets on Robinhood Chain by realized performance, activity, and community sentiment.">
        <FilterTabs value={period} options={RANKING_PERIODS.filter(p => p !== "all").map((p) => ({ value: p, label: PERIOD_LABELS[p], href: href(p, filter, q) }))} ariaLabel="Ranking period" />
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <a href={`/traders?source=analyst&period=${period}`} className="text-sm text-neon">Analyst computed rankings</a>
        <form className="flex items-center gap-2" action="/traders">
          <input type="hidden" name="period" value={period} /><input type="hidden" name="filter" value={filter} />
          <input name="q" defaultValue={q} aria-label="Find a trader" placeholder="Name or wallet address" className="h-9 w-52 rounded-lg border border-border bg-surface px-3 text-sm" />
          <button className="h-9 rounded-lg border border-border px-3 text-xs">Search</button>
        </form>
        <FilterTabs size="sm" value={filter} options={FILTERS.map((f) => ({ ...f, href: href(period, f.value, q) }))} ariaLabel="Trader filter" />
        {q && (
          <p className="text-sm text-secondary">
            Matching “{q}”.{" "}
            <a href={href(period, filter)} className="text-neon hover:underline">
              Clear
            </a>
          </p>
        )}
      </div>
      <LiveLeaderboard initial={traders} initialStatus={rankingState} period={period} filter={filter} query={q} page={page} />
      <nav aria-label="Trader pages" className="mt-5 flex items-center justify-between text-sm">{page > 1 ? <a href={href(period, filter, q, page - 1)} className="rounded-lg border border-border px-4 py-2">Previous</a> : <span />}<span className="text-muted">Page {page}</span>{rows.length > 25 ? <a href={href(period, filter, q, page + 1)} className="rounded-lg border border-border px-4 py-2">Next page</a> : <span />}</nav>
      <p className="mt-3 text-xs text-muted">Rankings compare realized profit for the selected period. Wallets without available profit data are excluded.</p>
    </div>
  );
}
