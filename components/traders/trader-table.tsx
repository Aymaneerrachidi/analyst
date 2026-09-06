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
  return (
    <div className="card overflow-hidden">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(HEAD, "w-14")}>#</th>
              <th className={HEAD}>Trader</th>
              <th className={HEAD}>Follow</th>
              <th className={HEAD}>Rating</th>
              <th className={cn(HEAD, "text-right")}>Net PnL</th>
              <th className={cn(HEAD, "text-right")}>ROI</th>
              <th className={cn(HEAD, "text-right")}>Win rate</th>
              <th className={cn(HEAD, "text-right")}>Trades</th>
              <th className={cn(HEAD, "text-right")}>B / S</th>
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
                    <Link href={`/trader/${t.id}`} className="group inline-flex items-center gap-3">
                      <TraderAvatar name={t.name} id={t.id} avatar={t.avatar} size="md" />
                      <span className="flex flex-col">
                        <span className="font-medium text-primary group-hover:underline">{t.name}</span>
                        <span className="font-mono text-xs text-muted">{shortAddress(t.wallet)}</span>
                        {t.statsSource && <span className="text-[10px] text-muted" title={`Snapshot captured ${t.statsUpdatedAt}`}>Defined · {t.statsUpdatedAt?.slice(0, 10)}</span>}
                      </span>
                    </Link>
                  </td>
                  <td className={CELL}><FollowButton trader={t} compact /></td>
                  <td className={CELL}>
                    <Rating value={t.communityRating} count={t.ratingCount} />
                  </td>
                  <td className={cn(CELL, "text-right font-medium")}>
                    <MoneyDelta value={t.realizedPnl} />
                  </td>
                  <td className={cn(CELL, "text-right")}>
                    <PctDelta value={t.roi} />
                  </td>
                  <td className={cn(CELL, "text-right tnum")}>{formatPct(t.winRate, { signed: false, digits: 0 })}</td>
                  <td className={cn(CELL, "text-right tnum")}>{t.trades ?? "—"}</td>
                  <td className={cn(CELL, "text-right tnum")}>
                    <span className="text-neon">{t.buys ?? "Unavailable"}</span>
                    <span className="text-muted"> / </span>
                    <span className="text-negative">{t.sells ?? "Unavailable"}</span>
                  </td>
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
              <Link href={`/trader/${t.id}`} className="flex items-center gap-3 px-4 py-3">
                <RankCell rank={rank} />
                <TraderAvatar name={t.name} id={t.id} avatar={t.avatar} size="md" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{t.name}</span>
                    <span className="text-xs text-muted">
                      <Rating value={t.communityRating} />
                    </span>
                  </span>
                  <span className="text-xs text-muted tnum">
                    {formatPct(t.winRate, { signed: false, digits: 0 })} win · {t.trades ?? 0} trades
                    {t.topToken && <> · ${t.topToken.symbol}</>}
                  </span>
                </span>
                <span className="text-right">
                  <MoneyDelta value={t.realizedPnl} className="block text-sm font-medium" />
                  <PctDelta value={t.roi} className="block text-xs" />
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
            <Link href={`/trader/${t.id}`} className="flex items-center gap-3 px-4 py-[18px] transition-colors hover:bg-hover">
              <RankCell rank={rank} />
              <TraderAvatar name={t.name} id={t.id} avatar={t.avatar} size="md" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{t.name}</span>
                <span className="text-xs text-muted tnum">
                  <Rating value={t.communityRating} /> · {formatPct(t.winRate, { signed: false, digits: 0 })} win rate
                </span>
              </span>
              <span className="text-right">
                <MoneyDelta value={t.realizedPnl} className="block text-sm font-medium" />
                <span className="block text-[11px] text-muted">30D</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
