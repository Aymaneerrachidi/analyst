import type { Metadata } from "next";
import { ensureFresh } from "@/lib/services/sync";
import { listTokens, type TokenTab } from "@/lib/services/intelligence";
import { FLOW_WINDOWS, type FlowWindow } from "@/lib/providers/types";
import { PageHeader } from "@/components/common/section-header";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { TokenMonitor } from "@/components/tokens/token-monitor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Token Monitor" };

const TABS: { value: TokenTab; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "accumulating", label: "Accumulating" },
  { value: "distributing", label: "Distributing" },
  { value: "traded", label: "Most traded" },
  { value: "new", label: "New activity" },
];

function href(tab: TokenTab, window: FlowWindow, q?: string, page = 1): string {
  const qs = new URLSearchParams();
  if (tab !== "trending") qs.set("tab", tab);
  if (window !== "24h") qs.set("w", window);
  if (q) qs.set("q", q);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/tokens?${s}` : "/tokens";
}

export default async function TokensPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t.value === sp.tab) ? (sp.tab as TokenTab) : "trending";
  const window = (FLOW_WINDOWS as string[]).includes(String(sp.w)) ? (sp.w as FlowWindow) : "24h";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 40) : "";
  const page = Math.min(100, Math.max(1, Number(sp.page) || 1));

  await ensureFresh("trades", 8_000);
  const tokens = await listTokens({ tab, window, limit: 100, offset: (page - 1) * 100, query: q || undefined });

  return (
    <div>
      <PageHeader title="See where money moves." description="Explore token accumulation, selling pressure, and conviction across tracked wallets on Robinhood Chain.">
        <FilterTabs value={window} options={FLOW_WINDOWS.map((w) => ({ value: w, label: w.toUpperCase(), href: href(tab, w, q) }))} ariaLabel="Window" />
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterTabs size="sm" value={tab} options={TABS.map((t) => ({ ...t, href: href(t.value, window, q) }))} ariaLabel="Token view" />
        {q && (
          <p className="text-sm text-secondary">
            Matching “{q}”.{" "}
            <a href={href(tab, window)} className="text-neon hover:underline">
              Clear
            </a>
          </p>
        )}
      </div>
      <TokenMonitor initial={tokens} tab={tab} window={window} page={page} query={q} />
      <nav aria-label="Token pages" className="mt-5 flex items-center justify-between text-sm">
        {page > 1 ? <a href={href(tab, window, q, page - 1)} className="rounded-full border border-border px-4 py-2 hover:bg-hover">Previous</a> : <span />}
        <span className="text-muted">Page {page}</span>
        {tokens.length === 100 ? <a href={href(tab, window, q, page + 1)} className="rounded-full border border-border px-4 py-2 hover:bg-hover">Next page</a> : <span />}
      </nav>
      <p className="mt-3 text-xs text-muted">
        KOL net flow is buy USD minus sell USD from tracked traders in the selected window. The Analyst Score is explainable and not a price prediction.
      </p>
    </div>
  );
}
