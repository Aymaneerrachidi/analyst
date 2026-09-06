import { Performance } from "@/components/tracking/performance";
import { FollowButton } from "@/components/tracking/follow-button";
import { WorkspaceTabs } from "@/components/workspace/tabs";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { ensureFresh, refreshTraderProfiles } from "@/lib/services/sync";
import { getTrader, getTraderPnlSeries, getTraderPositions, getTraderRanks, listTrades } from "@/lib/services/intelligence";
import { listComments } from "@/lib/social/posts";
import { getGuest } from "@/lib/social/guest";
import { seedSocialIfEmpty } from "@/lib/db/seed-social";
import { explorerAddressUrl, explorerBase } from "@/lib/explorer";
import { formatPct, formatUsd, shortAddress } from "@/lib/format";
import type { RankingPeriod } from "@/lib/types";
import { TraderAvatar, TokenAvatar } from "@/components/common/avatar";
import { CopyButton } from "@/components/common/copy-button";
import { MetricCard, MoneyDelta } from "@/components/common/metric";
import { CommunityRating } from "@/components/common/community-rating";
import { SectionHeader } from "@/components/common/section-header";
import { TimeAgo } from "@/components/common/time-ago";
import { PnlChart } from "@/components/traders/pnl-chart";
import { LiveTradesFeed } from "@/components/trades/trade-table";
import { DiscussionThread } from "@/components/social/discussion-thread";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const trader = await getTrader(id).catch(() => null);
  return { title: trader ? `${trader.name} · Trader` : "Trader" };
}

const RANK_LABEL: Record<RankingPeriod, string> = { "24h": "Daily", "7d": "Weekly", "30d": "Monthly", all: "All time" };

export default async function TraderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureFresh("trades", 8_000);
  await refreshTraderProfiles([id]);
  const trader = await getTrader(id);
  if (!trader) notFound();
  await seedSocialIfEmpty().catch(() => undefined);
  const guest = await getGuest();
  const [ranks, positions, series, trades, comments] = await Promise.all([
    getTraderRanks(trader.id),
    getTraderPositions(trader.id, 12),
    getTraderPnlSeries(trader.id, "30d"),
    listTrades({ traderId: trader.id, limit: 25 }),
    listComments({ targetType: "trader", targetId: trader.id, sort: "top", guestId: guest?.id ?? null }),
  ]);

  const buys = trader.buys ?? 0;
  const sells = trader.sells ?? 0;
  const buyShare = buys + sells > 0 ? (buys / (buys + sells)) * 100 : null;
  const bestRank = (Object.entries(ranks) as [RankingPeriod, number][]).sort((a, b) => a[1] - b[1])[0];

  return (
    <div className="space-y-5 pt-5">
      {/* Header */}
      <section className="flex flex-col gap-6 border-b border-border pb-8 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <TraderAvatar name={trader.name} id={trader.id} avatar={trader.avatar} size="lg" />
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-medium tracking-[-0.035em] md:text-3xl">{trader.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-secondary">
              <CopyButton value={trader.wallet} label="Copy wallet address">
                <span className="text-secondary">{shortAddress(trader.wallet, 6)}</span>
              </CopyButton>
              <a href={explorerAddressUrl(trader.wallet)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-neon">
                Explorer <ArrowUpRight className="h-3 w-3" />
              </a>
              {trader.twitterUrl && (
                <a href={trader.twitterUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-primary">
                  @{trader.handle} <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <FollowButton trader={trader} />
              {bestRank && (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neon/30 bg-neon/10 px-2.5 text-xs font-semibold text-neon tnum">
                  #{bestRank[1]} {RANK_LABEL[bestRank[0]]}
                </span>
              )}
              {(Object.entries(ranks) as [RankingPeriod, number][])
                .filter(([p]) => !bestRank || p !== bestRank[0])
                .sort((a, b) => a[1] - b[1])
                .slice(0, 2)
                .map(([p, r]) => (
                  <span key={p} className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-xs text-secondary tnum">
                    #{r} {RANK_LABEL[p]}
                  </span>
                ))}
              <span className="text-xs text-muted">
                Last active <TimeAgo value={trader.lastActive} />
              </span>
            </div>
          </div>
        </div>
        <div className="w-full md:w-64">
          <CommunityRating targetType="trader" targetId={trader.id} initial={{ average: trader.communityRating ?? null, count: trader.ratingCount ?? 0 }} variant="card" label="Community rating" />
        </div>
      </section>

      {trader.statsSource && <p className="rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-secondary">Additional history from <a href={`https://www.defined.fi/trader/${trader.wallet}`} target="_blank" rel="noreferrer" className="text-neon">Defined</a>, captured {trader.statsUpdatedAt?.slice(0, 10)}. Imported history is partial; period rankings and recorded trade totals can differ.</p>}
      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Net PnL" value={<MoneyDelta value={trader.realizedPnl} />} hint="Realized, all tracked history" />
        <MetricCard label="24H PnL" value={<MoneyDelta value={trader.pnl24h} />} />
        <MetricCard label="7D PnL" value={<MoneyDelta value={trader.pnl7d} />} />
        <MetricCard label="30D PnL" value={<MoneyDelta value={trader.pnl30d} />} hint={trader.roi !== null && trader.roi !== undefined ? `ROI ${formatPct(trader.roi)}` : undefined} />
        <MetricCard label="Win rate" value={formatPct(trader.winRate, { signed: false, digits: 0 })} hint="Share of profitable sells" />
        <MetricCard label="Total trades" value={trader.trades ?? "—"} hint={trader.volumeUsd ? `${formatUsd(trader.volumeUsd)} volume` : undefined} />
        <MetricCard label="Buy / sell" value={buyShare !== null ? `${Math.round(buyShare)}% buys` : "—"}>
          {buyShare !== null && (
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
              <div className="bg-neon" style={{ width: `${buyShare}%` }} />
              <div className="bg-negative" style={{ width: `${100 - buyShare}%` }} />
            </div>
          )}
          <p className="mt-1 text-xs text-muted tnum">
            <span className="text-neon">{buys}</span> / <span className="text-negative">{sells}</span>
          </p>
        </MetricCard>
        <MetricCard label="Avg trade size" value={formatUsd(trader.avgTradeSize)} hint={trader.bestTradeUsd ? `Best trade ${formatUsd(trader.bestTradeUsd)}` : undefined} />
      </section>

      {/* Performance */}
      <section>
        <SectionHeader eyebrow="Performance" title="Realized PnL" />
        <PnlChart
          traderId={trader.id}
          initialSeries={series}
          initialPeriod="30d"
          periodPnl={{ "24h": trader.pnl24h, "7d": trader.pnl7d, "30d": trader.pnl30d, all: trader.realizedPnl }}
        />
      </section>

      <Performance wallet={trader.wallet} />

      <WorkspaceTabs labels={["Token history", "Swaps", "Discussion"]}>
      {/* Positions */}
      <section>
        <SectionHeader eyebrow="Tokens" title="Current and recent tokens" description="Holdings come from the data source; bought, sold and realized figures come from tracked trades." />
        {positions.length === 0 ? (
          <EmptyState title="No token history yet." />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="label-caps px-4 py-2.5 text-left">Token</th>
                  <th className="label-caps px-3 py-2.5 text-right">First buy</th>
                  <th className="label-caps px-3 py-2.5 text-right">Latest buy</th>
                  <th className="label-caps px-3 py-2.5 text-right">Bought</th>
                  <th className="label-caps px-3 py-2.5 text-right">Sold</th>
                  <th className="label-caps px-3 py-2.5 text-right">Holding</th>
                  <th className="label-caps px-4 py-2.5 text-right">Realized</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.token.address} className="border-b border-border last:border-b-0 hover:bg-hover">
                    <td className="px-4 py-3">
                      <Link href={`/token/${p.token.address}`} className="group inline-flex items-center gap-2.5">
                        <TokenAvatar symbol={p.token.symbol} address={p.token.address} image={p.token.image} size="sm" />
                        <span className="font-medium group-hover:underline">${p.token.symbol}</span>
                        {p.buys + p.sells > 0 && (
                          <span className="text-xs text-muted tnum">
                            {p.buys}b / {p.sells}s
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right text-muted">
                      <TimeAgo value={p.firstBuyAt} long />
                    </td>
                    <td className="px-3 py-3 text-right text-muted">
                      <TimeAgo value={p.lastBuyAt} long />
                    </td>
                    <td className="px-3 py-3 text-right tnum">{p.buys > 0 ? formatUsd(p.boughtUsd) : <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-3 text-right tnum">{p.sells > 0 ? formatUsd(p.soldUsd) : <span className="text-muted">—</span>}</td>
                    <td className={cn("px-3 py-3 text-right tnum", (p.exposureUsd ?? 0) > 0 ? "text-primary" : "text-muted")}>{p.exposureUsd && p.exposureUsd > 1 ? formatUsd(p.exposureUsd) : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <MoneyDelta value={p.realizedPnl} muted />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent trades */}
      <section>
        <SectionHeader eyebrow="Activity" title="Recent trades" href={`/live`} hrefLabel="Live feed" />
        <LiveTradesFeed initialTrades={trades} params={{ trader: trader.id }} limit={25} explorerBase={explorerBase()} hideTrader emptyTitle="No tracked trades yet." />
      </section>

      {/* Community */}
      <section>
        <DiscussionThread targetType="trader" targetId={trader.id} initialComments={comments} title={`Discuss ${trader.name}`} placeholder={`What do you think about ${trader.name}?`} />
      </section>
      </WorkspaceTabs>
    </div>
  );
}
