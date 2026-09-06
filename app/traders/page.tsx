import type { Metadata } from "next";
import { ensureFresh } from "@/lib/services/sync";
import { listTraders, type TraderFilter } from "@/lib/services/intelligence";
import { RANKING_PERIODS, type RankingPeriod } from "@/lib/providers/types";
import { PageHeader } from "@/components/common/section-header";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { TraderTable } from "@/components/traders/trader-table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Top Traders" };

const PERIOD_LABELS: Record<RankingPeriod, string> = { "24h": "Daily", "7d": "Weekly", "30d": "Monthly", all: "All time" };
const FILTERS: { value: TraderFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "memecoins", label: "Memecoins" },
  { value: "volume", label: "High volume" },
  { value: "active", label: "Most active" },
  { value: "winrate", label: "Best win rate" },
];

function href(period: RankingPeriod, filter: TraderFilter, q?: string): string {
  const qs = new URLSearchParams();
  if (period !== "30d") qs.set("period", period);
  if (filter !== "all") qs.set("filter", filter);
  if (q) qs.set("q", q);
  const s = qs.toString();
  return s ? `/traders?${s}` : "/traders";
}

export default async function TradersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const period = (RANKING_PERIODS as string[]).includes(String(sp.period)) ? (sp.period as RankingPeriod) : "30d";
  const filter = FILTERS.some((f) => f.value === sp.filter) ? (sp.filter as TraderFilter) : "all";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 40) : "";

  await ensureFresh("trades", 8_000);
  let traders = await listTraders({ period, filter, limit: 100 });
  if (q) {
    const needle = q.toLowerCase();
    traders = traders.filter((t) => t.name.toLowerCase().includes(needle) || t.handle.toLowerCase().includes(needle) || t.wallet.includes(needle));
  }

  return (
    <div>
      <PageHeader title="Follow the traders." description="Compare tracked wallets on Robinhood Chain by realized performance, activity, and community sentiment.">
        <FilterTabs value={period} options={RANKING_PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p], href: href(p, filter, q) }))} ariaLabel="Ranking period" />
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-3">
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
      <TraderTable traders={traders} emptyTitle={q ? `No traders match “${q}”.` : undefined} />
      <p className="mt-3 text-xs text-muted">Net PnL is realized PnL over the selected period. Ratings are community sentiment (1–10) and are separate from performance.</p>
    </div>
  );
}
