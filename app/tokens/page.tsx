import { ASSET_CATEGORIES, type AssetCategory } from "@/lib/presentation";
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

function href(tab: TokenTab, window: FlowWindow, q?: string, page = 1, category: AssetCategory = "memes"): string {
  const qs = new URLSearchParams();
  qs.set("category", category);
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
  const page = Math.min(100, Math.max(1, Math.floor(Number(sp.page) || 1)));
  const category: AssetCategory = ASSET_CATEGORIES.includes(sp.category as AssetCategory) ? sp.category as AssetCategory : q ? "all" : "memes";

  await ensureFresh("trades", 8_000);
  const tokens = await listTokens({ tab, window, category, limit: 100, offset: (page - 1) * 100, query: q || undefined });

  return (
    <div>
      <PageHeader title="See where money moves." description="Explore token accumulation, selling pressure, and conviction across tracked wallets on Robinhood Chain.">
        <FilterTabs value={window} options={FLOW_WINDOWS.map((w) => ({ value: w, label: w.toUpperCase(), href: href(tab, w, q, 1, category) }))} ariaLabel="Window" />
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterTabs size="sm" value={tab} options={TABS.map((t) => ({ ...t, href: href(t.value, window, q, 1, category) }))} ariaLabel="Token view" />
        {q && (
          <p className="text-sm text-secondary">
            Matching “{q}”.{" "}
            <a href={href(tab, window, undefined, 1, category)} className="text-neon hover:underline">
              Clear
            </a>
          </p>
        )}
      </div>
      <p className="mb-3 text-xs text-muted">Categories follow token metadata, not verified issuers. Other includes unclassified assets; new means first tracked in the last 24 hours.</p>
      <div className="mb-4"><FilterTabs size="sm" value={category} options={ASSET_CATEGORIES.map(value => ({ value, label: ({all:"All", memes:"Memes", stocks:"Stock-linked", stablecoins:"Stablecoins", other:"Other", new:"Newly tracked"})[value], href: href(tab, window, q, 1, value) }))} ariaLabel="Asset category" /></div>
      <TokenMonitor category={category} initial={tokens} tab={tab} window={window} page={page} query={q} />
      <nav aria-label="Token pages" className="mt-5 flex items-center justify-between text-sm">
        {page > 1 ? <a href={href(tab, window, q, page - 1, category)} className="rounded-full border border-border px-4 py-2 hover:bg-hover">Previous</a> : <span />}
        <span className="text-muted">Page {page}</span>
        {tokens.length === 100 ? <a href={href(tab, window, q, page + 1, category)} className="rounded-full border border-border px-4 py-2 hover:bg-hover">Next page</a> : <span />}
      </nav>
      <p className="mt-3 text-xs text-muted">
        Tracked trader net flow is buy USD minus sell USD from tracked traders in the selected window. The Analyst Score is explainable and not a price prediction.
      </p>
    </div>
  );
}
