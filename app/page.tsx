import Link from "next/link";
import { ArrowRightIcon, ArrowUpRightIcon, ChatCircleIcon, ArrowUpIcon } from "@phosphor-icons/react/dist/ssr";
import { ensureFresh, getFreshness } from "@/lib/services/sync";
import { getOverviewStats, listTokens, listTraders, listTrades } from "@/lib/services/intelligence";
import { listPosts } from "@/lib/social/posts";
import { seedSocialIfEmpty } from "@/lib/db/seed-social";
import { getGuest } from "@/lib/social/guest";
import { explorerBase } from "@/lib/explorer";
import { formatCompact, formatUsd } from "@/lib/format";
import { FLOW_WINDOWS, type FlowWindow } from "@/lib/providers/types";
import { SectionHeader } from "@/components/common/section-header";
import { TrendingStrip } from "@/components/tokens/token-cards";
import { TopBuysTable } from "@/components/tokens/token-table";
import { TraderMiniList } from "@/components/traders/trader-table";
import { LiveTradesFeed } from "@/components/trades/trade-table";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { TraderAvatar } from "@/components/common/avatar";
import { TimeAgo } from "@/components/common/time-ago";
import { RichBody } from "@/components/social/rich-body";
import { EmptyState } from "@/components/ui/states";
import { ScoreGuide } from "@/components/home/score-guide";

export const dynamic = "force-dynamic";

function pickWindow(v: string | string[] | undefined): FlowWindow {
  const s = Array.isArray(v) ? v[0] : v;
  return (FLOW_WINDOWS as string[]).includes(s ?? "") ? (s as FlowWindow) : "24h";
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const window = pickWindow(sp.w);
  await ensureFresh("trades", 8_000);
  await seedSocialIfEmpty().catch(() => undefined);
  const guest = await getGuest();

  const [freshness, stats, trending, topBuys, topTraders, trades, posts] = await Promise.all([
    getFreshness(),
    getOverviewStats(),
    listTokens({ window: "24h", tab: "trending", limit: 4 }),
    listTokens({ window, tab: "accumulating", limit: 6 }),
    listTraders({ period: "30d", limit: 5 }),
    listTrades({ limit: 6 }),
    listPosts({ guestId: guest?.id ?? null, sort: "top", limit: 2 }),
  ]);

  return (
    <div>
      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-5">
        <div><p className="mb-1 text-[11px] text-neon">ROBINHOOD CHAIN / OVERVIEW</p><h1 id="home-title" className="text-2xl font-medium tracking-tight md:text-3xl">The market, in focus.</h1><p className="mt-1 text-xs text-secondary">Follow conviction. Discover tokens. See trades as they arrive.</p></div>
        <Link href="/watchlist" className="rounded-lg border border-border px-4 py-2.5 text-xs text-secondary hover:text-neon">Your watchlist <span aria-hidden>↗</span></Link>
      </section>
      <section className="grid grid-cols-2 divide-x divide-border border-b border-border md:grid-cols-4" aria-label="Market overview">
        {[['Tracked traders', formatCompact(freshness.trackedTraders)], ['Trades · 24H', formatCompact(stats.trades24h)], ['Tracked buying · 24H', formatUsd(stats.buyUsd24h)], ['Active tokens · 24H', formatCompact(stats.tokensActive24h)]].map(([label,value])=><div key={label} className="p-4"><p className="text-[10px] text-muted">{label}</p><p className="mt-1 text-xl font-medium tnum">{value}</p></div>)}
      </section>
      <section className="mt-5"><SectionHeader title="Trending now" href="/tokens" hrefLabel="All tokens" /><TrendingStrip tokens={trending} /></section>
      <div className="section-space grid grid-flow-dense items-start gap-10 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] xl:gap-7">
        <section className="min-w-0">
          <SectionHeader
            title="Where conviction is building"
            description="Net buying across tracked wallets. Choose your window."
            action={<FilterTabs size="sm" value={window} options={FLOW_WINDOWS.map((w) => ({ value: w, label: w.toUpperCase(), href: w === "24h" ? "/" : `/?w=${w}` }))} ariaLabel="Accumulation window" />}
          />
          <TopBuysTable tokens={topBuys} window={window} compact />
          <Link href="/tokens?tab=accumulating" className="mt-3 inline-flex min-h-10 items-center gap-2 text-[13px] font-medium text-secondary hover:text-neon">Explore accumulation <ArrowRightIcon className="h-4 w-4" /></Link>
        </section>
        <section className="min-w-0">
          <SectionHeader title="Leading the way" description="Highest realized PnL over the last 30 days." />
          <TraderMiniList traders={topTraders} />
          <Link href="/traders" className="mt-3 inline-flex min-h-10 items-center gap-2 text-[13px] font-medium text-secondary hover:text-neon">Full leaderboard <ArrowRightIcon className="h-4 w-4" /></Link>
        </section>
      </div>

      <section className="section-space">
        <SectionHeader title="The latest moves" description="A live view of buys and sells from tracked wallets." href="/live" hrefLabel="Open live feed" />
        <LiveTradesFeed initialTrades={trades} limit={6} explorerBase={explorerBase()} />
      </section>

      <ScoreGuide />

      <section className="section-space">
        <SectionHeader title="The conversation behind the trades" description="Compare notes with others watching Robinhood Chain." href="/social" hrefLabel="Join the community" />
        {posts.length === 0 ? (
          <EmptyState title="Bring your first observation." description="Start a conversation about a token or trader." action={<Link href="/social" className="text-sm text-neon">Write a post</Link>} />
        ) : (
          <div className="grid grid-flow-dense gap-4 md:grid-cols-2">
            {posts.map((p) => (
              <article key={p.id} className="card flex flex-col p-5 transition-colors hover:border-border-hover md:p-6">
                <div className="mb-4 flex items-center gap-2.5 text-xs">
                  <TraderAvatar name={p.author.displayName} id={p.author.id} size="sm" />
                  <span className="font-medium text-primary">{p.author.displayName}</span>
                  <TimeAgo value={p.createdAt} className="ml-auto text-muted" />
                </div>
                <RichBody body={p.body} refs={p.refs} className="line-clamp-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-primary" />
                <Link href={`/social/${p.id}`} className="mt-auto flex items-center gap-4 pt-5 text-xs text-muted transition-colors hover:text-neon" aria-label={`Read ${p.author.displayName}'s discussion`}>
                  <span className="inline-flex items-center gap-1"><ArrowUpIcon className="h-3.5 w-3.5" />{p.score}</span>
                  <span className="inline-flex items-center gap-1.5"><ChatCircleIcon className="h-3.5 w-3.5" />{p.replyCount} replies</span>
                  <ArrowUpRightIcon className="ml-auto h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
