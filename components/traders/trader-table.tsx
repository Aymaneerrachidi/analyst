import { StatsSource } from "@/components/common/stats-source";
import { FollowButton } from "@/components/tracking/follow-button";
import Link from "next/link";
import { formatCount, formatPct, formatRating, shortAddress } from "@/lib/format";
import type { AnalystTrader } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TokenAvatar, TraderAvatar } from "@/components/common/avatar";
import { MoneyDelta, PctDelta } from "@/components/common/metric";
import { TimeAgo } from "@/components/common/time-ago";
import { EmptyState } from "@/components/ui/states";
import { Star } from "lucide-react";

const HEAD = "px-3 py-2.5 text-left label-caps first:pl-4 last:pr-4 whitespace-nowrap";
const CELL = "px-3 py-3 align-middle first:pl-4 last:pr-4";

function RankCell({ rank }: { rank: number }) {
  const podium = rank <= 3;
  return (
    <span className={cn("inline-flex h-6 min-w-7 items-center justify-center rounded-md px-1.5 text-[12px] font-semibold tnum", podium ? "bg-neon/10 text-neon" : "text-muted")}>
      {rank.toString().padStart(2, "0")}
    </span>
  );
}

function Rating({ value, count }: { value: number | null | undefined; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={count ? `${formatCount(count)} community ratings` : "No community ratings yet"}>
      <Star className={cn("h-3.5 w-3.5", value ? "fill-neon text-neon" : "text-muted")} />
      <span className="font-medium tnum">{formatRating(value)}</span>
    </span>
  );
}

export function TraderTable({ traders, emptyTitle = "No ranked traders for this period yet." }: { traders: AnalystTrader[]; emptyTitle?: string }) {
  if (traders.length === 0) return <EmptyState title={emptyTitle} description="Rankings appear once the data source has synced trades for this window." />;
  const showRating = traders.some(t => t.communityRating != null);
  const showBreakdown = traders.some(t => t.buys != null && t.sells != null);
  return (
    <div className="card overflow-hidden">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(HEAD, "w-14")}>#</th>
              <th className={HEAD}>Trader</th>
              <th className={HEAD}>Follow</th>
              {showRating && <th className={HEAD}>Rating</th>}
              <th className={cn(HEAD, "text-right")}>Source PnL</th>
              <th className={cn(HEAD, "text-right")}>ROI</th>
              <th className={cn(HEAD, "text-right")}>Win rate</th>
              <th className={cn(HEAD, "text-right")}>Trades</th>
              {showBreakdown && <th className={cn(HEAD, "text-right")}>B / S</th>}
              <th className={HEAD}>Top token</th>
              <th className={cn(HEAD, "text-right")}>Last active</th>
            </tr>
          </thead>
          <tbody>
            {traders.map((t, i) => {
              const rank = t.rank ?? i + 1;
              return (
                <tr key={t.id} className={cn("border-b border-border last:border-b-0 hover:bg-hover", rank <= 3 && "bg-neon/[0.02]")}>
                  <td className={CELL}>
                    <RankCell rank={rank} />
                  </td>
                  <td className={CELL}>
                    <Link href={`/trader/${t.id}?period=${t.statsPeriod ?? "30d"}`} className="group inline-flex items-center gap-3">
                      <TraderAvatar name={t.name} id={t.id} avatar={t.avatar} size="md" />
                      <span className="flex flex-col">
                        <span className="font-medium text-primary group-hover:underline">{t.name}</span>
                        <span className="font-mono text-xs text-muted">{shortAddress(t.wallet)}</span>
                        <StatsSource trader={t} />
                      </span>
                    </Link>
                  </td>
                  <td className={CELL}><FollowButton trader={t} compact /></td>
                  {showRating && <td className={CELL}>
                    <Rating value={t.communityRating} count={t.ratingCount} />
                  </td>}
                  <td className={cn(CELL, "text-right font-medium")}>
                    <MoneyDelta value={t.realizedPnl} /><StatsSource trader={t} />
                  </td>
                  <td className={cn(CELL, "text-right")}>
                    <PctDelta value={t.roi} />
                  </td>
                  <td className={cn(CELL, "text-right tnum")}>{formatPct(t.winRate, { signed: false, digits: 0 })}</td>
                  <td className={cn(CELL, "text-right tnum")}>{t.trades ?? "—"}</td>
                  {showBreakdown && <td className={cn(CELL, "text-right tnum")}>
                    {t.buys == null || t.sells == null ? <span className="text-xs text-muted" title="Buy/sell breakdown is not available from this source">Not supplied</span> : <><span className="text-neon">{t.buys}</span><span className="text-muted"> / </span><span className="text-negative">{t.sells}</span></>}
                  </td>}
                  <td className={CELL}>
                    {t.topToken ? (
                      <Link href={`/token/${t.topToken.address}`} className="group inline-flex items-center gap-2">
                        <TokenAvatar symbol={t.topToken.symbol} address={t.topToken.address} image={t.topToken.image} size="xs" />
                        <span className="font-medium group-hover:underline">${t.topToken.symbol}</span>
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className={cn(CELL, "text-right text-muted")}>
                    <TimeAgo value={t.lastActive} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="md:hidden">
        {traders.map((t, i) => {
          const rank = t.rank ?? i + 1;
          return (
            <li key={t.id} className="border-b border-border last:border-b-0">
              <Link href={`/trader/${t.id}?period=${t.statsPeriod ?? "30d"}`} className="flex items-center gap-3 px-4 py-3">
                <RankCell rank={rank} />
                <TraderAvatar name={t.name} id={t.id} avatar={t.avatar} size="md" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{t.name}</span>
                    <span className="text-xs text-muted">
                      {t.communityRating != null && <Rating value={t.communityRating} />}
                    </span>
                  </span>
                  <span className="text-xs text-muted tnum">
                    {formatPct(t.winRate, { signed: false, digits: 0 })} win · {t.trades == null ? "Trade count not supplied" : `${t.trades} trades`}
                    {t.topToken && <> · ${t.topToken.symbol}</>}
                  </span>
                </span>
                <span className="text-right">
                  <MoneyDelta value={t.realizedPnl} className="block text-sm font-medium" />
                  <StatsSource trader={t} /><PctDelta value={t.roi} className="block text-xs" />
                </span>
              </Link>
              <div className="px-4 pb-3"><FollowButton trader={t} /></div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Compact top-N list for the homepage. */
export function TraderMiniList({ traders }: { traders: AnalystTrader[] }) {
  if (traders.length === 0) return <EmptyState title="No ranked traders yet." />;
  return (
    <ol className="card divide-y divide-border overflow-hidden">
      {traders.map((t, i) => {
        const rank = t.rank ?? i + 1;
        return (
          <li key={t.id}>
            <Link href={`/trader/${t.id}?period=${t.statsPeriod ?? "30d"}`} className="flex items-center gap-3 px-4 py-[18px] transition-colors hover:bg-hover">
              <RankCell rank={rank} />
              <TraderAvatar name={t.name} id={t.id} avatar={t.avatar} size="md" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{t.name}</span>
                <span className="text-xs text-muted tnum">
                  {t.communityRating != null && <><Rating value={t.communityRating} /> · </>}{t.winRate != null && <>{formatPct(t.winRate, { signed: false, digits: 0 })} win rate</>}
                </span>
              </span>
              <span className="text-right">
                <MoneyDelta value={t.realizedPnl} className="block text-sm font-medium" />
                <StatsSource trader={t} />
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
