import Link from "next/link";
import { formatPct, formatPrice, formatUsd, shortAddress } from "@/lib/format";
import type { AnalystToken } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TokenAvatar, TraderAvatar } from "@/components/common/avatar";
import { MoneyDelta, PctDelta } from "@/components/common/metric";
import { AnalystScoreBadge } from "@/components/common/analyst-score";
import { EmptyState } from "@/components/ui/states";

const HEAD = "px-3 py-2.5 text-left label-caps first:pl-4 last:pr-4 whitespace-nowrap";
const CELL = "px-3 py-3 align-middle first:pl-4 last:pr-4";

export function NetFlow({ token, size = "md" }: { token: AnalystToken; size?: "sm" | "md" | "lg" }) {
  return (
    <span className="inline-flex flex-col items-end">
      <MoneyDelta value={token.netAccumulation} className={cn("font-semibold", size === "sm" ? "text-sm" : size === "md" ? "text-base" : "text-2xl tracking-tight")} />
      <span className={cn("text-muted tnum", size === "lg" ? "text-xs" : "text-[11px]")}>
        {token.buyers} {token.buyers === 1 ? "buyer" : "buyers"} · {token.sellers} {token.sellers === 1 ? "seller" : "sellers"}
      </span>
    </span>
  );
}

export function TokenTable({ tokens, emptyTitle = "No token activity in this window." }: { tokens: AnalystToken[]; emptyTitle?: string }) {
  if (tokens.length === 0) return <EmptyState title={emptyTitle} description="Try a wider window or another tab." />;
  const window = tokens[0]?.window;
  return (
    <div className="card overflow-hidden">
      <div className="hidden overflow-x-auto min-[900px]:block">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border">
            <th className={HEAD}>Token</th><th className={cn(HEAD, "text-right")}>Price / 24h</th>
            <th className={cn(HEAD, "text-right")}>Valuation</th><th className={cn(HEAD, "text-right")}>Volume · 24h</th>
            <th className={cn(HEAD, "text-right")}>Tracked activity</th><th className={cn(HEAD, "text-right")}>Net flow</th>
            <th className={cn(HEAD, "text-right")}>Score</th>
          </tr></thead>
          <tbody>{tokens.map((t, i) => (
            <tr key={t.address} className="border-b border-border last:border-b-0 transition-colors duration-150 hover:bg-hover">
              <td className={CELL}><Link href={`/token/${t.address}`} className="group flex items-center gap-3">
                <span className="w-5 text-xs text-muted tnum">{i + 1}</span>
                <TokenAvatar symbol={t.symbol} address={t.address} image={t.image} />
                <span className="flex min-w-0 flex-col gap-1"><span className="font-semibold text-primary group-hover:text-neon">${t.symbol}</span>
                <span className="max-w-[180px] truncate text-xs text-muted" title={t.name}>{t.name !== t.symbol ? t.name : shortAddress(t.address)}</span></span>
              </Link></td>
              <td className={cn(CELL, "text-right tnum")}>
                {t.price != null ? <><span className="block font-medium">{formatPrice(t.price)}</span>{t.price != null && t.priceChange24h != null && <span className="mt-1 block text-xs"><PctDelta value={t.priceChange24h} /></span>}</> : <span className="text-xs text-muted">Price not indexed</span>}
              </td>
              <td className={cn(CELL, "text-right tnum")}>
                {t.marketCap != null || t.fdv != null ? <><span className="block">{formatUsd(t.marketCap ?? t.fdv)}</span><span className="mt-1 block text-xs text-muted">{t.marketCap != null ? "On-chain token MC" : "Token FDV"}</span></> : <span className="text-xs text-muted">Unverified supply</span>}
              </td>
              <td className={cn(CELL, "text-right text-secondary tnum")}>{t.volume24h != null ? formatUsd(t.volume24h) : <span className="text-xs text-muted">Not indexed</span>}</td>
              <td className={cn(CELL, "text-right tnum")}><span className="block">{t.trackedTraders} {t.trackedTraders === 1 ? "trader" : "traders"}</span><span className="mt-1 block whitespace-nowrap text-xs"><span className="text-neon">{t.traderBuys} {t.traderBuys === 1 ? "buy" : "buys"}</span><span className="px-1 text-muted">·</span><span className="text-negative">{t.traderSells} {t.traderSells === 1 ? "sell" : "sells"}</span></span></td>
              <td className={cn(CELL, "text-right")}><NetFlow token={t} /></td>
              <td className={cn(CELL, "text-right")}><AnalystScoreBadge score={t.score} window={window} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <ul className="min-[900px]:hidden">{tokens.map((t) => (
        <li key={t.address} className="border-b border-border p-4 last:border-b-0">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/token/${t.address}`} className="flex min-w-0 items-center gap-3"><TokenAvatar symbol={t.symbol} address={t.address} image={t.image} />
              <span className="min-w-0"><span className="block break-all font-semibold">${t.symbol}</span><span className="mt-1 block text-xs text-muted">{t.trackedTraders} {t.trackedTraders === 1 ? "trader" : "traders"} · {t.traderBuys} {t.traderBuys === 1 ? "buy" : "buys"} · {t.traderSells} {t.traderSells === 1 ? "sell" : "sells"}</span></span>
            </Link><AnalystScoreBadge score={t.score} window={window} />
          </div>
          <div className="mt-4 flex items-end justify-between gap-3 tnum"><div>
            <span className="block text-xs text-muted">Price</span><span className="mt-1 block text-sm">{t.price != null ? formatPrice(t.price) : "Not indexed"}{t.price != null && t.priceChange24h != null && <span className="ms-2 text-xs"><PctDelta value={t.priceChange24h} /></span>}</span>
            {(t.marketCap != null || t.fdv != null) && <span className="mt-1 block text-xs text-muted">{t.marketCap != null ? "On-chain token MC" : "Token FDV"} {formatUsd(t.marketCap ?? t.fdv)}</span>}
          </div><div className="text-right"><span className="mb-1 block text-xs text-muted">Tracked trader net flow</span><NetFlow token={t} size="sm" /></div></div>
        </li>
      ))}</ul>
    </div>
  );
}

/** Homepage "Top Tracked trader buys" module: fewer columns, net flow dominant. */
export function TopBuysTable({ tokens, window, compact }: { tokens: AnalystToken[]; window: string; compact?: boolean }) {
  if (tokens.length === 0) return <EmptyState title="No tracked buys in this window." />;
  return (
    <div className="card overflow-hidden">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(HEAD, "w-10")}>#</th>
              <th className={HEAD}>Token</th>
              {!compact && <th className={cn(HEAD, "text-right")}>Price</th>}
              {!compact && <th className={cn(HEAD, "text-right")}>24H</th>}
              <th className={cn(HEAD, "text-right")}>Buys</th>
              <th className={cn(HEAD, "text-right")}>Sells</th>
              <th className={cn(HEAD, "text-right")}>Net flow</th>
              {!compact && <th className={HEAD}>Top buyer</th>}
              <th className={cn(HEAD, "text-right")}>Score</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t, i) => (
              <tr key={t.address} className="border-b border-border last:border-b-0 hover:bg-hover">
                <td className={cn(CELL, "text-muted tnum")}>{i + 1}</td>
                <td className={CELL}>
                  <Link href={`/token/${t.address}`} className="group inline-flex items-center gap-3">
                    <TokenAvatar symbol={t.symbol} address={t.address} image={t.image} size="sm" />
                    <span className="font-medium group-hover:underline">${t.symbol}</span>
                  </Link>
                </td>
                {!compact && <td className={cn(CELL, "text-right tnum")}>{formatPrice(t.price)}</td>}
                {!compact && <td className={cn(CELL, "text-right")}><PctDelta value={t.priceChange24h} /></td>}
                <td className={cn(CELL, "text-right text-neon tnum")}>{t.traderBuys}</td>
                <td className={cn(CELL, "text-right text-negative tnum")}>{t.traderSells}</td>
                <td className={cn(CELL, "text-right")}>
                  <MoneyDelta value={t.netAccumulation} className="text-base font-semibold" />
                </td>
                {!compact && <td className={CELL}>
                  {t.topBuyer ? (
                    <Link href={`/trader/${t.topBuyer.id}`} className="group inline-flex items-center gap-2">
                      <TraderAvatar name={t.topBuyer.name} id={t.topBuyer.id} avatar={t.topBuyer.avatar} size="xs" />
                      <span className="group-hover:underline">{t.topBuyer.name}</span>
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>}
                <td className={cn(CELL, "text-right")}>
                  <AnalystScoreBadge score={t.score} window={window} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden">
        {tokens.map((t) => (
          <li key={t.address} className="border-b border-border last:border-b-0">
            <div className="flex items-center gap-3 px-4 py-3">
              <Link href={`/token/${t.address}`} className="flex min-w-0 flex-1 items-center gap-3">
                <TokenAvatar symbol={t.symbol} address={t.address} image={t.image} size="md" />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">${t.symbol}</span>
                  <span className="text-xs text-muted tnum">
                    <span className="text-neon">{t.traderBuys} {t.traderBuys === 1 ? "buy" : "buys"}</span> · <span className="text-negative">{t.traderSells} {t.traderSells === 1 ? "sell" : "sells"}</span>
                    {t.topBuyer && <> · {t.topBuyer.name}</>}
                  </span>
                </span>
              </Link>
              <span className="text-right">
                <MoneyDelta value={t.netAccumulation} className="block text-sm font-semibold" />
                <span className="block text-[11px] text-muted">{formatPct(t.priceChange24h)} 24H</span>
              </span>
              <AnalystScoreBadge score={t.score} window={window} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
