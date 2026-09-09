import 'server-only';
import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { zeroAddress, type Address } from 'viem';
import { getDb, schema } from '@/lib/db';
import { explorerTransactions } from '@/lib/providers/blockscout';
import { sharedLoad } from '@/lib/v2/shared-cache';

/** Observed relationships only. A transfer or timing match never proves common ownership. */
export async function walletDetective(address: Address) {
  return sharedLoad(`detective:${address}`, 120_000, async () => {
    const db = await getDb(), now = new Date(), since = new Date(now.getTime() - 30 * 86_400_000);
    const [native, transfers, swaps, pools] = await Promise.all([
      explorerTransactions(address),
      db.select().from(schema.chainTransfers).where(and(or(eq(schema.chainTransfers.from, address), eq(schema.chainTransfers.to, address)), gte(schema.chainTransfers.timestamp, since))).orderBy(desc(schema.chainTransfers.timestamp)).limit(200),
      db.select().from(schema.chainSwaps).where(and(eq(schema.chainSwaps.walletAddress, address), gte(schema.chainSwaps.timestamp, since))).orderBy(desc(schema.chainSwaps.timestamp)).limit(100),
      db.select({ address: schema.liquidityPools.address }).from(schema.liquidityPools),
    ]);
    const excluded = new Set([address, zeroAddress, ...pools.map(p => p.address)]);
    type Edge = { peer: string; relationship: string; confidence: number; first: Date; last: Date; evidence: { hash: string; at: string; description: string }[] };
    const edges = new Map<string, Edge>();
    function add(peer: string, relationship: string, confidence: number, hash: string, at: Date, description: string) {
      if (excluded.has(peer) || !Number.isFinite(at.getTime()) || at > now || at < since) return;
      const key = `${relationship}:${peer}`, existing = edges.get(key);
      if (existing) { if (!existing.evidence.some(e => e.hash === hash) && existing.evidence.length < 10) existing.evidence.push({ hash, at: at.toISOString(), description }); existing.first = new Date(Math.min(existing.first.getTime(), at.getTime())); existing.last = new Date(Math.max(existing.last.getTime(), at.getTime())); }
      else edges.set(key, { peer, relationship, confidence, first: at, last: at, evidence: [{ hash, at: at.toISOString(), description }] });
    }
    for (const tx of native.stale ? [] : native.data?.items ?? []) {
      if (tx.status !== 'ok' || BigInt(tx.value) === BigInt(0) || new Date(tx.timestamp) < since) continue;
      if (tx.to?.hash === address && !tx.from.is_contract) add(tx.from.hash, 'observed_native_funding', 0.95, tx.hash, new Date(tx.timestamp), `Incoming native transfer: ${tx.value} wei. This is not necessarily the first funding transaction.`);
      if (tx.from.hash === address && tx.to && !tx.to.is_contract) add(tx.to.hash, 'native_transfer', 0.95, tx.hash, new Date(tx.timestamp), `Outgoing native transfer: ${tx.value} wei.`);
    }
    for (const tx of transfers) {
      if (BigInt(tx.amountRaw) === BigInt(0)) continue;
      add(tx.from === address ? tx.to : tx.from, 'token_transfer', 0.9, tx.txHash, tx.timestamp, `Indexed ${tx.tokenAddress} transfer; raw amount ${tx.amountRaw}. Token transfers can be unsolicited.`);
    }
    const tokens = [...new Set(swaps.map(s => s.tokenAddress))];
    const neighbours = tokens.length ? await db.select().from(schema.chainSwaps).where(and(inArray(schema.chainSwaps.tokenAddress, tokens), gte(schema.chainSwaps.timestamp, since))).orderBy(desc(schema.chainSwaps.timestamp)).limit(5000) : [];
    const matches = new Map<string, { tokens: Set<string>; trades: { hash: string; at: Date; token: string }[] }>();
    for (const own of swaps) for (const other of neighbours) {
      if (other.walletAddress === address || other.tokenAddress !== own.tokenAddress || other.side !== own.side || other.txHash === own.txHash || Math.abs(other.timestamp.getTime() - own.timestamp.getTime()) > 30_000) continue;
      const entry = matches.get(other.walletAddress) ?? { tokens: new Set<string>(), trades: [] };
      entry.tokens.add(other.tokenAddress);
      if (entry.trades.length < 10 && !entry.trades.some(t => t.hash === other.txHash)) entry.trades.push({ hash: other.txHash, at: other.timestamp, token: other.tokenAddress });
      matches.set(other.walletAddress, entry);
    }
    for (const [peer, match] of matches) if (match.tokens.size >= 3 && match.trades.length >= 3) for (const trade of match.trades) add(peer, 'repeated_trade_timing', 0.35, trade.hash, trade.at, `Same-side swaps within 30 seconds on ${match.tokens.size} distinct tokens, including ${trade.token}. Shared market reactions can explain this.`);
    const output = [...edges.values()].sort((a, b) => b.last.getTime() - a.last.getTime()).slice(0, 50);
    for (const edge of output) {
      const id = createHash('sha256').update(`${address}:${edge.peer}:${edge.relationship}`).digest('hex');
      const row = { id, walletA: address, walletB: edge.peer, relationship: edge.relationship, confidence: edge.confidence, evidence: edge.evidence, firstSeen: edge.first, lastSeen: edge.last };
      await db.insert(schema.walletEdges).values(row).onConflictDoUpdate({ target: schema.walletEdges.id, set: { evidence: edge.evidence, lastSeen: edge.last, confidence: edge.confidence } });
    }
    return { wallet: address, edges: output.map(e => ({ ...e, first: e.first.toISOString(), last: e.last.toISOString() })), provenance: { source: 'Blockscout transactions + Analyst indexed transfers/swaps', period: '30d', calculatedAt: now.toISOString(), completeness: 'partial', transferLimit: 200, ownSwapLimit: 100, neighbourSwapLimit: 5000, explorerObservedAt: native.observedAt, explorerStale: native.stale },
      explanation: 'Confidence describes evidence of the stated relationship, not shared ownership, coordination or insider status. Explorer funding uses the latest returned page; incomplete histories cannot establish first funding.' };
  });
}
