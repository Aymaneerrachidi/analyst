import type { Side } from "@/lib/providers/types";

/**
 * Average-cost realized PnL. Pure and provider-agnostic.
 *
 * When a trade carries a token amount we can keep a real position (quantity + cost basis)
 * and attribute realized PnL to each sell. When amounts are unavailable (some upstreams only
 * expose USD value), realized PnL is left null and only USD in/out is tracked — the UI shows
 * that honestly instead of inventing a number.
 */

export interface PnlInputTrade {
  id: string;
  wallet: string;
  tokenAddress: string;
  side: Side;
  amountUsd: number;
  tokenAmount?: number | null;
  timestamp: number; // epoch ms
}

export interface Position {
  wallet: string;
  tokenAddress: string;
  qty: number;
  costBasis: number;
  buys: number;
  sells: number;
  boughtUsd: number;
  soldUsd: number;
  realizedPnl: number | null;
  wins: number;
  losses: number;
  firstBuyAt: number | null;
  lastBuyAt: number | null;
  lastTradeAt: number | null;
  hasAmounts: boolean;
}

export interface PnlResult {
  perTrade: Map<string, number | null>;
  costBasisByTrade: Map<string, number>;
  positions: Map<string, Position>;
}

export function positionKey(wallet: string, tokenAddress: string): string {
  return `${wallet}:${tokenAddress}`;
}

export function computePnl(trades: PnlInputTrade[]): PnlResult {
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const perTrade = new Map<string, number | null>();
  const costBasisByTrade = new Map<string, number>();
  const positions = new Map<string, Position>();

  for (const t of sorted) {
    const key = positionKey(t.wallet, t.tokenAddress);
    let pos = positions.get(key);
    if (!pos) {
      pos = {
        wallet: t.wallet,
        tokenAddress: t.tokenAddress,
        qty: 0,
        costBasis: 0,
        buys: 0,
        sells: 0,
        boughtUsd: 0,
        soldUsd: 0,
        realizedPnl: null,
        wins: 0,
        losses: 0,
        firstBuyAt: null,
        lastBuyAt: null,
        lastTradeAt: null,
        hasAmounts: true,
      };
      positions.set(key, pos);
    }
    const amount = t.tokenAmount && t.tokenAmount > 0 ? t.tokenAmount : null;
    if (amount === null) pos.hasAmounts = false;
    pos.lastTradeAt = t.timestamp;

    if (t.side === "BUY") {
      pos.buys += 1;
      pos.boughtUsd += t.amountUsd;
      pos.firstBuyAt = pos.firstBuyAt ?? t.timestamp;
      pos.lastBuyAt = t.timestamp;
      if (amount !== null && pos.hasAmounts) {
        pos.qty += amount;
        pos.costBasis += t.amountUsd;
      }
      perTrade.set(t.id, null);
      continue;
    }

    pos.sells += 1;
    pos.soldUsd += t.amountUsd;
    if (amount === null || !pos.hasAmounts) {
      perTrade.set(t.id, null);
      continue;
    }
    const sellQty = Math.min(amount, pos.qty);
    if (sellQty <= 0) {
      // No tracked position: cost basis is unknown, so no realized PnL can be attributed.
      perTrade.set(t.id, null);
      continue;
    }
    const avgCost = pos.costBasis / pos.qty;
    const coveredShare = amount > 0 ? sellQty / amount : 0;
    const proceedsCovered = t.amountUsd * coveredShare;
    // Proceeds beyond the tracked position are ignored rather than counted as pure profit.
    const realized = proceedsCovered - avgCost * sellQty;
    costBasisByTrade.set(t.id, avgCost * sellQty);
    pos.qty -= sellQty;
    pos.costBasis = Math.max(0, pos.costBasis - avgCost * sellQty);
    if (pos.qty <= 1e-9) {
      pos.qty = 0;
      pos.costBasis = 0;
    }
    pos.realizedPnl = (pos.realizedPnl ?? 0) + realized;
    if (realized > 0) pos.wins += 1;
    else pos.losses += 1;
    perTrade.set(t.id, realized);
  }

  return { perTrade, costBasisByTrade, positions };
}

export interface WalletSummary {
  wallet: string;
  realizedPnl: number | null;
  volumeUsd: number;
  trades: number;
  buys: number;
  sells: number;
  winRate: number | null;
  bestTradeUsd: number | null;
  avgTradeSize: number | null;
  roi: number | null;
}

export function summarizeWallets(trades: PnlInputTrade[], result: PnlResult): Map<string, WalletSummary> {
  const out = new Map<string, WalletSummary>();
  const performance = new Map<string, { wins: number; sells: number; costBasis: number }>();
  const ensure = (wallet: string): WalletSummary => {
    let s = out.get(wallet);
    if (!s) {
      s = {
        wallet,
        realizedPnl: null,
        volumeUsd: 0,
        trades: 0,
        buys: 0,
        sells: 0,
        winRate: null,
        bestTradeUsd: null,
        avgTradeSize: null,
        roi: null,
      };
      out.set(wallet, s);
    }
    return s;
  };

  for (const t of trades) {
    const s = ensure(t.wallet);
    s.trades += 1;
    s.volumeUsd += t.amountUsd;
    if (t.side === "BUY") s.buys += 1;
    else s.sells += 1;
    const r = result.perTrade.get(t.id);
    if (r !== null && r !== undefined) {
      s.realizedPnl = (s.realizedPnl ?? 0) + r;
      if (s.bestTradeUsd === null || r > s.bestTradeUsd) s.bestTradeUsd = r;
      const p = performance.get(t.wallet) ?? { wins: 0, sells: 0, costBasis: 0 };
      if (r > 0) p.wins += 1;
      p.sells += 1;
      p.costBasis += result.costBasisByTrade.get(t.id) ?? 0;
      performance.set(t.wallet, p);
    }
  }

  for (const s of out.values()) {
    // Realized return uses the cost basis of the sells in this window, even when
    // the corresponding buys preceded it. Unclosed positions do not dilute ROI.
    const p = performance.get(s.wallet);
    if (p && p.sells > 0) s.winRate = (p.wins / p.sells) * 100;
    if (s.trades > 0) s.avgTradeSize = s.volumeUsd / s.trades;
    if (p && p.costBasis > 0 && s.realizedPnl !== null) s.roi = (s.realizedPnl / p.costBasis) * 100;
  }
  return out;
}
