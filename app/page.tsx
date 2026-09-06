import Link from "next/link";
import { ArrowRightIcon, ArrowUpRightIcon, ChatCircleIcon, ArrowUpIcon, PulseIcon } from "@phosphor-icons/react/dist/ssr";
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
import { LinkButton } from "@/components/ui/button";
import { TraderAvatar } from "@/components/common/avatar";
import { TimeAgo } from "@/components/common/time-ago";
import { RichBody } from "@/components/social/rich-body";
import { EmptyState } from "@/components/ui/states";
import { ChainArtwork } from "@/components/home/chain-artwork";
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
      <section className="relative grid items-center gap-0 py-9 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:py-9 lg:py-12" aria-labelledby="home-title">
        <div className="relative">
          <p className="mb-5 flex items-center gap-2 text-xs font-medium text-secondary"><PulseIcon className="h-4 w-4 text-neon" /> A closer look at onchain conviction</p>
          <h1 id="home-title" className="max-w-5xl text-[clamp(2.25rem,4.55vw,4rem)] font-medium leading-[1.08] tracking-[-0.055em]">
            Follow the money.<br /><span className="text-neon">See the conviction.</span>
          </h1>
          <p className="mt-5 max-w-[420px] text-[15px] leading-relaxed text-secondary md:text-base">See what tracked traders are buying on Robinhood Chain. Follow their moves. Build your own view.</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <LinkButton href="/live" variant="primary" size="lg">Explore live trades <ArrowUpRightIcon className="h-[18px] w-[18px]" /></LinkButton>
            <LinkButton href="/traders" variant="ghost" size="lg" className="px-3">Meet the traders <ArrowRightIcon className="h-4 w-4" /></LinkButton>
          </div>
        </div>
        <div className="mx-auto -mb-4 mt-0 w-full max-w-[300px] md:my-0 md:max-w-none"><ChainArtwork /></div>
      </section>

      <section aria-label="Tracked market activity" className="border-y border-border">
        <dl className="grid grid-cols-2 py-1 sm:grid-cols-4 sm:py-5">
          <Stat label="Buy volume" detail="Past 24 hours" value={formatUsd(stats.buyUsd24h)} accent />
          <Stat label="Tracked trades" detail="Past 24 hours" value={formatCompact(stats.trades24h)} />
          <Stat label="Active tokens" detail="Past 24 hours" value={formatCompact(stats.tokensActive24h)} />
          <Stat label="Tracked traders" detail="In our coverage" value={formatCompact(stats.trackedTraders)} />
        </dl>
        <p className="border-t border-border py-2.5 text-[11px] leading-relaxed text-muted">
          {freshness.isMock ? "Synthetic demo activity" : <><a href="https://kolhood.io" target="_blank" rel="noreferrer" className="underline decoration-border-hover underline-offset-2 hover:text-primary">KOLHOOD</a> tracked-wallet activity</>}<span className="mx-2">/</span>Coverage reflects tracked wallets, not the whole network.
        </p>
      </section>

      <section className="section-space">
        <SectionHeader title="On the radar" description="Tokens attracting attention from tracked traders in the last 24 hours." href="/tokens" hrefLabel="All tokens" />
        {trending.length ? <TrendingStrip tokens={trending} /> : <EmptyState title="Waiting for token activity" description="Tracked tokens appear here after the next successful sync." />}
      </section>

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

function Stat({ label, detail, value, accent }: { label: string; detail: string; value: string; accent?: boolean }) {
  return (
    <div className="market-stat px-4 py-5 first:pl-0 sm:py-1 sm:pl-7">
      <dt className="text-xs font-medium text-secondary">{label}</dt>
      <dd className={`mt-2 font-mono text-[clamp(1.35rem,2.3vw,2rem)] font-medium tracking-[-0.055em] ${accent ? "text-neon" : "text-primary"}`}>{value}</dd>
      <dd className="mt-1 text-[11px] text-muted">{detail}</dd>
    </div>
  );
}
