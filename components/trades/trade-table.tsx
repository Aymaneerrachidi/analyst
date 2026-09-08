"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTradeStream } from "@/components/live/stream-provider";
import { matchesTrade, mergeLiveTrades } from "@/lib/client/live-trades";
import { apiGet } from "@/lib/client/fetcher";
import { formatPrice, formatUsd, shortAddress } from "@/lib/format";
import type { AnalystTrade, Freshness } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TokenAvatar, TraderAvatar } from "@/components/common/avatar";
import { MoneyDelta, SideBadge } from "@/components/common/metric";
import { TimeAgo } from "@/components/common/time-ago";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonLines } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { groupTradeBursts } from "@/lib/trade-bursts";

export function txUrl(explorerBase: string, hash: string | null | undefined): string | null {
  if (!hash) return null;
  return `${explorerBase.replace(/\/$/, "")}/tx/${hash}`;
}

interface TableProps {
  trades: AnalystTrade[];
  explorerBase: string;
  hideTrader?: boolean;
  hideToken?: boolean;
  animateNew?: boolean;
  /** Hides price and PnL columns for narrow placements. */
  compact?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

const HEAD = "px-3 py-2.5 text-left label-caps first:pl-4 last:pr-4";
const CELL = "px-3 py-2.5 align-middle first:pl-4 last:pr-4";

export function TradeTable({ trades, explorerBase, hideTrader, hideToken, animateNew = true, compact, emptyTitle = "No trades yet.", emptyDescription }: TableProps) {
  // Rows present at mount never animate; anything that arrives later does (framer applies `initial` once, at row mount).
  const [initialIds] = useState(() => new Set(trades.map((t) => t.id)));
  const showPrice = !compact && trades.some(t => t.price != null);
  const showPnl = !compact && trades.some(t => t.side === "SELL" && t.realizedPnl != null);
  const isNewRow = (id: string) => animateNew && !initialIds.has(id);

  if (trades.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  return (
    <div className="card overflow-hidden">
      {/* Desktop */}
      <div className="hidden overflow-x-auto md:block">
        <table className={cn("w-full text-sm", compact ? "min-w-[520px]" : "min-w-[820px]")}>
          <thead>
            <tr className="border-b border-border">
              <th className={cn(HEAD, "w-16")}>Time</th>
              {!hideTrader && <th className={HEAD}>Trader</th>}
              <th className={cn(HEAD, "w-20")}>Action</th>
              {!hideToken && <th className={HEAD}>Token</th>}
              <th className={cn(HEAD, "text-right")}>Value</th>
              {showPrice && <th className={cn(HEAD, "text-right")}>Price</th>}
              {showPnl && <th className={cn(HEAD, "text-right")}>Tracked PnL</th>}
              <th className={cn(HEAD, "w-14 text-right")}>Tx</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {trades.map((t) => {
                const isNew = isNewRow(t.id);
                return (
                  <motion.tr
                    key={t.id}
                    layout="position"
                    initial={isNew ? { opacity: 0, backgroundColor: t.side === "BUY" ? "rgba(204,255,0,0.10)" : "rgba(255,77,103,0.10)" } : false}
                    animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }}
                    transition={{ duration: 0.9, ease: "easeOut" }}
                    className="border-b border-border last:border-b-0 hover:bg-hover"
                  >
                    <td className={cn(CELL, "text-muted")}>
                      <TimeAgo value={t.timestamp} />
                    </td>
                    {!hideTrader && (
                      <td className={CELL}>
                        <Link href={`/trader/${t.trader.id}`} className="group inline-flex items-center gap-2.5">
                          <TraderAvatar name={t.trader.name} id={t.trader.id} avatar={t.trader.avatar} size="sm" />
                          <span className="font-medium text-primary group-hover:underline">{t.trader.name}</span>
                        </Link>
                      </td>
                    )}
                    <td className={CELL}>
                      <SideBadge side={t.side} />
                    </td>
                    {!hideToken && (
                      <td className={CELL}>
                        <Link href={`/token/${t.token.address}`} className="group inline-flex items-center gap-2.5">
                          <TokenAvatar symbol={t.token.symbol} address={t.token.address} image={t.token.image} size="sm" />
                          <span className="font-medium text-primary group-hover:underline">${t.token.symbol}</span>
                        </Link>
                      </td>
                    )}
                    <td className={cn(CELL, "text-right font-medium tnum")}>{formatUsd(t.amountUsd)}</td>
                    {showPrice && <td className={cn(CELL, "text-right text-secondary tnum")}>{formatPrice(t.price)}</td>}
                    {showPnl && (
                      <td className={cn(CELL, "text-right tnum")}>{t.side === "SELL" ? <MoneyDelta value={t.realizedPnl} muted /> : <span className="text-muted">—</span>}</td>
                    )}
                    <td className={cn(CELL, "text-right")}>
                      <TxLink explorerBase={explorerBase} hash={t.txHash} />
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="md:hidden">
        <AnimatePresence initial={false}>
          {trades.map((t) => {
            const isNew = isNewRow(t.id);
            return (
              <motion.li
                key={t.id}
                layout="position"
                initial={isNew ? { opacity: 0, backgroundColor: t.side === "BUY" ? "rgba(204,255,0,0.10)" : "rgba(255,77,103,0.10)" } : false}
                animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }}
                transition={{ duration: 0.9, ease: "easeOut" }}
                className="border-b border-border px-4 py-3 last:border-b-0"
              >
                <TradeCard trade={t} explorerBase={explorerBase} hideTrader={hideTrader} hideToken={hideToken} />
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}

export function TradeCard({ trade: t, explorerBase, hideTrader, hideToken }: { trade: AnalystTrade; explorerBase: string; hideTrader?: boolean; hideToken?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        {!hideTrader ? (
          <Link href={`/trader/${t.trader.id}`} className="inline-flex min-w-0 items-center gap-2">
            <TraderAvatar name={t.trader.name} id={t.trader.id} avatar={t.trader.avatar} size="xs" />
            <span className="truncate text-sm font-medium">{t.trader.name}</span>
          </Link>
        ) : (
          <span className="text-xs text-muted">{t.txHash ? shortAddress(t.txHash, 5) : ""}</span>
        )}
        <TimeAgo value={t.timestamp} className="text-xs text-muted" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <SideBadge side={t.side} />
        {!hideToken && (
          <Link href={`/token/${t.token.address}`} className="text-[15px] font-semibold">
            ${t.token.symbol}
          </Link>
        )}
        {t.side === "SELL" && t.realizedPnl !== null && t.realizedPnl !== undefined && <MoneyDelta value={t.realizedPnl} className="ml-auto text-sm" />}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-sm">
        <span className="tnum">
          <span className="font-medium">{formatUsd(t.amountUsd)}</span>
          {t.price !== null && t.price !== undefined && <span className="text-muted"> @ {formatPrice(t.price)}</span>}
        </span>
        <TxLink explorerBase={explorerBase} hash={t.txHash} label />
      </div>
    </div>
  );
}

function TxLink({ explorerBase, hash, label }: { explorerBase: string; hash: string | null | undefined; label?: boolean }) {
  const url = txUrl(explorerBase, hash);
  if (!url) return <span className="text-muted">—</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-neon" aria-label="View transaction in explorer">
      {label && "View tx"}
      <ArrowUpRight className="h-3.5 w-3.5" />
    </a>
  );
}

// ---------------------------------------------------------------------------
// Live feed: polls for trades newer than the highest sequence it has seen.
// ---------------------------------------------------------------------------

interface FeedProps {
  initialTrades: AnalystTrade[];
  params?: Record<string, string | undefined>;
  limit?: number;
  pollMs?: number;
  paused?: boolean;
  explorerBase: string;
  hideTrader?: boolean;
  hideToken?: boolean;
  compact?: boolean;
  onFreshness?: (f: Freshness) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

interface TradesResponse {
  trades: AnalystTrade[];
  freshness: Freshness;
}

function buildQuery(params: Record<string, string | undefined>, extra: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...extra })) {
    if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
  }
  return qs.toString();
}

export function LiveTradesFeed({ initialTrades, params = {}, limit = 50, pollMs = 5_000, explorerBase, hideTrader, hideToken, compact, onFreshness, emptyTitle, emptyDescription, paused = false }: FeedProps) {
  const [grouped, setGrouped] = useState(true);
  const qc = useQueryClient();
  const stream = useTradeStream();
  const paramsKey = JSON.stringify(params);
  const [initialKey] = useState(paramsKey);
  const listKey = useMemo(() => ["trades", "list", paramsKey, limit], [paramsKey, limit]);

  // The list for the current filters. Server-rendered rows seed the initial filter set; other filters fetch fresh.
  const list = useQuery({
    queryKey: listKey,
    queryFn: async ({ signal }) => {
      const res = await apiGet<TradesResponse>(`/api/trades?${buildQuery(params, { limit })}`, signal);
      onFreshness?.(res.freshness);
      return res.trades;
    },
    initialData: paramsKey === initialKey ? initialTrades : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: (prev) => prev,
  });
  const trades = list.data ?? [];
  const bursts = groupTradeBursts(trades);
  const hasBursts = bursts.some(b => b.trades.length > 1);
  const maxSeq = trades.reduce((m, t) => Math.max(m, t.seq), 0);

  useEffect(() => {
    if (!stream.enabled || paused || !stream.trades.length) return;
    const filters: Record<string, string | undefined> = JSON.parse(paramsKey);
    const incoming = stream.trades.map(t => ({ ...t, trader: stream.traders.get(t.traderId) ?? t.trader }))
      .filter(t => matchesTrade(t, filters, stream.traders));
    if (incoming.length) qc.setQueryData<AnalystTrade[]>(listKey, (previous = []) => mergeLiveTrades(previous, incoming, limit));
  }, [stream.enabled, stream.trades, stream.traders, paused, paramsKey, qc, listKey, limit]);

  // Poll for anything newer than what we hold and merge it into the cached list.
  const poll = useQuery({
    queryKey: ["trades", "poll", paramsKey, limit, maxSeq],
    queryFn: async ({ signal }) => {
      const res = await apiGet<TradesResponse>(`/api/trades?${buildQuery(params, { after: maxSeq, limit: 100 })}`, signal);
      onFreshness?.(res.freshness);
      if (res.trades.length > 0) {
        qc.setQueryData<AnalystTrade[]>(listKey, (prev = []) => {
          return mergeLiveTrades(prev, res.trades, limit);
        });
      }
      return res.trades.length;
    },
    enabled: !paused && list.data !== undefined && !list.isPlaceholderData,
    refetchInterval: pollMs,
    staleTime: 0,
  });

  const loading = list.isLoading || (list.isFetching && list.isPlaceholderData);

  return (
    <div className={cn(loading && "opacity-60 transition-opacity")} aria-busy={loading}>
      {list.isError && <ErrorState title="Trades couldn’t load." description="Try again to refresh this view." action={<Button onClick={() => void list.refetch()}>Retry trades</Button>} />}
      {poll.isError && !paused && <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">Live updates couldn’t refresh. Showing the last loaded trades.<Button size="sm" onClick={() => void poll.refetch()} disabled={poll.isFetching}>Retry updates</Button></div>}
      {list.isLoading ? <SkeletonLines count={5} /> : !list.isError && (
      <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{trades.length} loaded records</span><button aria-pressed={grouped} onClick={() => setGrouped(v => !v)} className="rounded-lg border border-border px-3 py-2 text-secondary">{grouped ? "Grouped bursts (60s)" : "Raw transactions"}</button></div>
      {grouped && hasBursts ? <div className="card divide-y divide-border">{bursts.map(b => { const t = b.trades[0]; return <details key={b.id} className="p-3"><summary className="cursor-pointer text-sm leading-6"><span className="font-medium">{t.trader.name}</span> <span className={t.side === "BUY" ? "text-neon" : "text-negative"}>{t.side === "BUY" ? "bought" : "sold"}</span> ${t.token.symbol} <span className="text-secondary">{b.trades.length}× · {b.knownValues ? formatUsd(b.knownUsd) : "Value unavailable"}{b.knownValues === b.trades.length ? " total" : b.knownValues ? " known value" : ""} · <TimeAgo value={t.timestamp} /></span></summary><div className="mt-3"><TradeTable trades={b.trades} explorerBase={explorerBase} hideTrader={hideTrader} hideToken={hideToken} compact={compact} animateNew={false} /></div></details>; })}</div> : <TradeTable
        key={paramsKey}
        trades={trades}
        explorerBase={explorerBase}
        hideTrader={hideTrader}
        hideToken={hideToken}
        compact={compact}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />}
      </>
      )}
    </div>
  );
}
