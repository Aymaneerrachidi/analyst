import { ActivitySignal } from "@/components/tracking/activity-signal";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { ensureFresh, refreshTokenMarketData, refreshTokenTraders } from "@/lib/services/sync";
import { getToken, getTokenTopTraders, listTrades } from "@/lib/services/intelligence";
import { listComments } from "@/lib/social/posts";
import { getGuest } from "@/lib/social/guest";
import { seedSocialIfEmpty } from "@/lib/db/seed-social";
import { explorerAddressUrl, explorerBase } from "@/lib/explorer";
import { formatPrice, formatUsd, shortAddress } from "@/lib/format";
import { FLOW_WINDOWS, type FlowWindow } from "@/lib/providers/types";
import { TokenAvatar, TraderAvatar } from "@/components/common/avatar";
import { CopyButton } from "@/components/common/copy-button";
import { MetricCard, MoneyDelta, PctDelta } from "@/components/common/metric";
import { AnalystScoreCard } from "@/components/common/analyst-score";
import { CommunityRating } from "@/components/common/community-rating";
import { SectionHeader } from "@/components/common/section-header";
import { TimeAgo } from "@/components/common/time-ago";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { EmptyState } from "@/components/ui/states";
import { NetFlow } from "@/components/tokens/token-table";
import { LiveTradesFeed } from "@/components/trades/trade-table";
import { DiscussionThread } from "@/components/social/discussion-thread";
import { WatchButton } from "@/components/workspace/watchlist";
import { WorkspaceTabs } from "@/components/workspace/tabs";
import { TokenChart } from "@/components/tokens/token-chart";
import { TokenResearch } from "@/components/tokens/token-research";
import { TradePanel } from "@/components/trading/trade-panel";
import { tokenContext } from "@/lib/intelligence/token-context";
import { TokenHolders } from "@/components/tokens/token-holders";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const token = await getToken(address).catch(() => null);
  return { title: token ? `$${token.symbol} · ${token.name}` : "Token" };
}

export default async function TokenPage({ params, searchParams }: { params: Promise<{ address: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ address }, sp] = await Promise.all([params, searchParams]);
  const window = (FLOW_WINDOWS as string[]).includes(String(sp.w)) ? (sp.w as FlowWindow) : "24h";
  await ensureFresh("trades", 8_000);
  await Promise.all([refreshTokenMarketData(address), refreshTokenTraders(address)]);
  const token = await getToken(address, window);
  if (!token) notFound();
  const intelligence = await tokenContext(token.address);
  await seedSocialIfEmpty().catch(() => undefined);
  const guest = await getGuest();
  const [topTraders, trades, comments] = await Promise.all([
    getTokenTopTraders(token.address, 8),
    listTrades({ tokenAddress: token.address, limit: 25 }),
    listComments({ targetType: "token", targetId: token.address, sort: "top", guestId: guest?.id ?? null }),
  ]);

  const participants = token.buyers + token.sellers + token.neutral;
  const bullishPct = participants > 0 ? Math.round((token.buyers / participants) * 100) : null;
  // eslint-disable-next-line react-hooks/purity -- Request-time cutoff in this dynamic server component.
  const chartCutoff = Date.now() - 86_400_000;
  const chartTrades = trades.filter(t => Date.parse(t.timestamp) >= chartCutoff);
  const sentimentLabel = bullishPct === null ? "No activity" : bullishPct >= 60 ? "Buy heavy" : bullishPct <= 40 ? "Sell heavy" : "Mixed";
  const hasMarketData = token.price !== null && token.price !== undefined;

  return (
    <div className="token-workspace">
      <div className="token-main space-y-4">
      {/* Header */}
      <section className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <TokenAvatar symbol={token.symbol} address={token.address} image={token.image} size="lg" />
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-medium tracking-[-0.035em]">
              ${token.symbol} <span className="text-secondary">{token.name !== token.symbol ? token.name : ""}</span>
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
              <CopyButton value={token.address} label="Copy contract address">
                <span className="text-secondary">{shortAddress(token.address, 6)}</span>
              </CopyButton>
              <a href={explorerAddressUrl(token.address)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-neon">
                Explorer <ArrowUpRight className="h-3 w-3" />
              </a>
              <span className="text-xs text-muted">
                Last activity <TimeAgo value={token.lastActivityAt} />
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-3xl font-semibold tracking-tight tnum">{formatPrice(token.price)}</span>
              <PctDelta value={token.priceChange24h} className="text-base font-medium" />
              {!hasMarketData && <span className="text-xs text-muted">Price data not available from the current source.</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2"><WatchButton token={token} /><FilterTabs size="sm" value={window} options={FLOW_WINDOWS.map((w) => ({ value: w, label: w.toUpperCase(), href: w === "24h" ? `/token/${token.address}` : `/token/${token.address}?w=${w}` }))} ariaLabel="Window" /></div>
      </section>

      {/* Market + flow stats */}
      <section className="grid grid-cols-2 gap-2 md:grid-cols-4 [&>div]:p-3 [&_p]:text-xs">
        <MetricCard label={token.marketCap != null ? "On-chain token market cap" : "Token fully diluted value"} value={formatUsd(token.marketCap ?? token.fdv)} />
        <MetricCard label="Volume · 24H" value={formatUsd(token.volume24h)} />
        <MetricCard label={`Tracked trader buys · ${window.toUpperCase()}`} value={<span className="text-neon">{token.traderBuys}</span>} hint={`${formatUsd(token.buyUsd)} bought`} />
        <MetricCard label={`Tracked trader sells · ${window.toUpperCase()}`} value={<span className="text-negative">{token.traderSells}</span>} hint={`${formatUsd(token.sellUsd)} sold`} />
      </section>

      {/* Top traders in token */}
      <TokenChart address={token.address} symbol={token.symbol} currentPrice={token.price} initialTrades={chartTrades} />
      <TokenResearch address={token.address} />
      <TradePanel key={token.address} address={token.address} symbol={token.symbol} risk={intelligence?.risk} />
      <TokenHolders address={token.address} />

      <WorkspaceTabs labels={["Active traders", "Swaps", "Discussion"]} initial={1}>
      <section>
        <SectionHeader title="Traders active in this token" description="Recorded buys and sells from synced wallet history. USD in/out is shown when cost basis is unavailable." />
        {topTraders.length === 0 ? (
          <EmptyState title="No recorded trades for this token yet." description="Wallet holdings can exist before trade history becomes available. New recorded trades will appear here." />
        ) : (
          <ol className="card divide-y divide-border">
            {topTraders.map((row) => (
              <li key={row.trader.id}>
                <Link href={`/trader/${row.trader.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover">
                  <TraderAvatar name={row.trader.name} id={row.trader.id} avatar={row.trader.avatar} size="md" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{row.trader.name}</span>
                    <span className="text-xs text-muted tnum">
                      {row.buys} {row.buys === 1 ? "buy" : "buys"} · {row.sells} {row.sells === 1 ? "sell" : "sells"} · last <TimeAgo value={row.lastTradeAt} long />
                    </span>
                  </span>
                  <span className="text-right">
                    {row.realizedPnl !== null ? (
                      <>
                        <MoneyDelta value={row.realizedPnl} className="block text-sm font-medium" />
                        <span className="block text-[11px] text-muted">realized</span>
                      </>
                    ) : (
                      <>
                        <MoneyDelta value={row.soldUsd - row.boughtUsd} className="block text-sm font-medium" />
                        <span className="block text-[11px] text-muted">USD out − in</span>
                      </>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Live activity */}
      <section>
        <SectionHeader eyebrow="Live activity" title={`Tracked trades in $${token.symbol}`} />
        <LiveTradesFeed initialTrades={trades} params={{ token: token.address }} limit={25} explorerBase={explorerBase()} hideToken emptyTitle="No tracked trades yet." />
      </section>

      {/* Community */}
      <section>
        <DiscussionThread targetType="token" targetId={token.address} initialComments={comments} title={`Discuss $${token.symbol}`} placeholder={`What do you think about $${token.symbol}?`} />
      </section>
      </WorkspaceTabs>
      </div>
      <aside className="token-insights space-y-3" aria-label="Token insights">      {/* Intelligence */}
      <section className="space-y-3">
        <ActivitySignal token={token} />
        <AnalystScoreCard score={token.score} window={window.toUpperCase()} />
        <div className="card p-5">
          <p className="label-caps">Tracked trader sentiment · {window.toUpperCase()}</p>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-4xl font-semibold leading-none tracking-tight tnum">{bullishPct === null ? "—" : `${bullishPct}%`}</span>
            <span className="pb-0.5 text-sm font-medium text-secondary">{sentimentLabel}</span>
          </div>
          <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
            {participants > 0 && (
              <>
                <div className="bg-neon" style={{ width: `${(token.buyers / participants) * 100}%` }} />
                <div className="bg-white/20" style={{ width: `${(token.neutral / participants) * 100}%` }} />
                <div className="bg-negative" style={{ width: `${(token.sellers / participants) * 100}%` }} />
              </>
            )}
          </div>
          <ul className="mt-3 space-y-1 text-sm tnum">
            <li className="flex justify-between"><span className="text-neon">{token.buyers} buying</span></li>
            <li className="flex justify-between"><span className="text-secondary">{token.neutral} neutral</span></li>
            <li className="flex justify-between"><span className="text-negative">{token.sellers} selling</span></li>
          </ul>
          <div className="mt-4 border-t border-border pt-3">
            <p className="label-caps">Tracked trader net flow</p>
            <div className="mt-1 flex justify-start">
              <NetFlow token={token} size="lg" />
            </div>
          </div>
        </div>
        <CommunityRating targetType="token" targetId={token.address} initial={{ average: token.communityRating ?? null, count: token.ratingCount ?? 0 }} variant="card" label="Community" />
      </section>

<a href={`https://fomo.family/tokens/robinhood/${token.address}`} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg border border-border p-3 text-xs text-secondary hover:text-neon">Open token on Fomo <ArrowUpRight className="h-4 w-4" /></a></aside>
    </div>
  );
}
