import { median } from "./metrics";
export interface ConsensusTrade { wallet: string; side: 'BUY' | 'SELL'; usd: number | null; timestamp: number; quality: number | null; confidence: number; qualityAt: number | null }
export function smartMoneyConsensus(trades: ConsensusTrade[], at: number, windowMs = 3_600_000) {
  const selected = trades.filter(t => t.timestamp <= at && t.timestamp > at - windowMs);
  const valued = selected.filter(t => t.usd != null && Number.isFinite(t.usd) && t.usd >= 0);
  const high = valued.filter(t => t.quality != null && t.quality >= 65 && t.confidence >= 0.6 && t.qualityAt != null && t.qualityAt <= at);
  const weighted = (t: ConsensusTrade) => t.usd! * (t.quality! / 100) * t.confidence * Math.exp(-(at - t.timestamp) / windowMs);
  const highBuyers = new Set(high.filter(t => t.side === 'BUY').map(t => t.wallet)).size;
  const highSellers = new Set(high.filter(t => t.side === 'SELL').map(t => t.wallet)).size;
  const weightedBuy = high.filter(t => t.side === 'BUY').reduce((sum, t) => sum + weighted(t), 0);
  const weightedSell = high.filter(t => t.side === 'SELL').reduce((sum, t) => sum + weighted(t), 0);
  const net = high.length ? high.reduce((sum, t) => sum + (t.side === 'BUY' ? t.usd! : -t.usd!), 0) : null;
  const trackedNet = valued.length ? valued.reduce((sum, t) => sum + (t.side === 'BUY' ? t.usd! : -t.usd!), 0) : null;
  const label = !high.length ? 'UNRATED ACTIVITY' : weightedSell > weightedBuy ? 'DISTRIBUTION' : highBuyers >= 3 && weightedBuy >= 5000 ? 'HIGH ACCUMULATION' : weightedBuy > weightedSell && highBuyers >= 2 ? 'ACCUMULATION' : 'WATCH';
  const uniqueQuality = [...new Map(high.map(t => [t.wallet, t.quality!])).values()];
  return { label, trackedBuyers: new Set(selected.filter(t => t.side === 'BUY').map(t => t.wallet)).size, trackedSellers: new Set(selected.filter(t => t.side === 'SELL').map(t => t.wallet)).size,
    highBuyers, highSellers, smartMoneyNet: net, trackedNet, weightedNet: high.length ? weightedBuy - weightedSell : null, medianQuality: median(uniqueQuality),
    score: high.length ? Math.round(100 * weightedBuy / Math.max(1, weightedBuy + weightedSell) * Math.min(1, highBuyers / 5)) : null,
    coverage: { trades: selected.length, knownUsd: valued.length, qualifiedTrades: high.length, source: 'Analyst computed', asOf: new Date(at).toISOString(), windowMs },
    methodology: 'Quality >=65, confidence >=0.6; quality × amount × confidence × recency. Unknown quality is excluded, not ranked as poor.',
  };
}
export interface RunnerInputs {
  at: number; lastTradeAt: number | null; marketObservedAt: number | null; price: number | null; marketCap: number | null; liquidity: number | null;
  volumeCurrent: number | null; volumePrevious: number | null; buyersCurrent: number; buyersPrevious: number;
  buysUsd: number | null; sellsUsd: number | null; smartMoneyScore: number | null; holderGrowth: number | null; priceChange1h: number | null; riskScore: number | null; riskLevel: string;
}
const bounded = (v: number) => Math.max(0, Math.min(100, v));
export function runnerSignal(input: RunnerInputs) {
  const volumeAcceleration = input.volumeCurrent != null && input.volumePrevious != null && input.volumePrevious > 0 ? input.volumeCurrent / input.volumePrevious : null;
  const buyerAcceleration = input.buyersPrevious > 0 ? input.buyersCurrent / input.buyersPrevious : null;
  const imbalance = input.buysUsd != null && input.sellsUsd != null && input.buysUsd + input.sellsUsd > 0 ? input.buysUsd / (input.buysUsd + input.sellsUsd) : null;
  const parts = [
    { key: 'volume', weight: 20, value: volumeAcceleration == null ? null : bounded((volumeAcceleration - 1) * 40) },
    { key: 'buyers', weight: 15, value: buyerAcceleration == null ? null : bounded((buyerAcceleration - 1) * 50) },
    { key: 'smartMoney', weight: 20, value: input.smartMoneyScore },
    { key: 'imbalance', weight: 15, value: imbalance == null ? null : bounded(imbalance * 100) },
    { key: 'holders', weight: 10, value: input.holderGrowth == null ? null : bounded(input.holderGrowth * 5) },
    { key: 'liquidity', weight: 10, value: input.liquidity == null ? null : bounded(Math.log10(Math.max(1, input.liquidity)) * 20 - 40) },
    { key: 'momentum', weight: 10, value: input.priceChange1h == null ? null : bounded(input.priceChange1h * 2) },
  ];
  const known = parts.filter(p => p.value != null && Number.isFinite(p.value));
  const coverage = known.reduce((sum, p) => sum + p.weight, 0) / 100;
  const raw = known.reduce((sum, p) => sum + p.weight * p.value! / 100, 0);
  const penalty = input.riskScore == null ? null : input.riskScore * 0.4;
  // Missing dimensions lower score coverage; unknown risk can never produce a confirmed runner label.
  const score = known.length ? Math.round(bounded(raw - (penalty ?? 0))) : null;
  const fresh = input.lastTradeAt != null && input.at - input.lastTradeAt <= 600_000 && input.marketObservedAt != null && input.at - input.marketObservedAt <= 180_000;
  const meaningful = fresh && input.buyersCurrent >= 3 && (input.volumeCurrent ?? 0) >= 1000 && input.price != null && input.price > 0 && input.liquidity != null && input.liquidity >= 5000 && (input.buysUsd ?? 0) > (input.sellsUsd ?? 0);
  const riskKnown = ['LOW', 'MODERATE'].includes(input.riskLevel);
  const eligible = meaningful && score != null && score >= 40 && input.riskLevel !== 'EXTREME' && input.riskLevel !== 'HIGH';
  const signalType = eligible && score! >= 70 && coverage >= 0.8 && riskKnown ? 'RUNNER' : eligible ? 'WATCH' : 'NO SIGNAL';
  const reasons = [volumeAcceleration == null ? 'Previous volume window unavailable' : `Recorded volume acceleration ${volumeAcceleration.toFixed(2)}x`, buyerAcceleration == null ? 'Previous buyer window unavailable' : `Unique buyer acceleration ${buyerAcceleration.toFixed(2)}x`, `${input.buyersCurrent} unique buyers in the current window`, `Risk: ${input.riskLevel}`, `Input coverage ${Math.round(coverage * 100)}%`];
  return { score, signalType, eligible, coverage, volumeAcceleration, buyerAcceleration, components: parts, riskPenalty: penalty, reasons, version: 'runner-v1', asOf: new Date(input.at).toISOString() };
}

export function signalOutcome(entry: { timestamp: number; price: number }, observations: { timestamp: number; price: number }[], horizonMs: number, now: number) {
  const end = entry.timestamp + horizonMs;
  if (end > now || entry.price <= 0) return null;
  const rows = observations.filter(p => p.timestamp > entry.timestamp && p.timestamp <= now && p.price > 0 && Number.isFinite(p.price)).sort((a, b) => a.timestamp - b.timestamp);
  const exit = rows.find(p => p.timestamp >= end && p.timestamp <= end + 90_000);
  if (!exit) return null;
  const range = [{ timestamp: entry.timestamp, price: entry.price }, ...rows.filter(p => p.timestamp <= exit.timestamp)];
  let peak = entry.price, drawdown = 0, maxGap = 0;
  range.forEach((p, i) => { peak = Math.max(peak, p.price); drawdown = Math.max(drawdown, (peak - p.price) / peak * 100); if (i) maxGap = Math.max(maxGap, p.timestamp - range[i - 1].timestamp); });
  return { returnPct: (exit.price / entry.price - 1) * 100, maxGain: (Math.max(...range.map(p => p.price)) / entry.price - 1) * 100, maxDrawdown: drawdown, points: range.length, complete: maxGap <= 120_000, exitAt: exit.timestamp, method: 'observed samples, not intra-sample price extremes' };
}
