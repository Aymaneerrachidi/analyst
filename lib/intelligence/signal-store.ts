import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { tokenContext, type TokenIntelligence } from "./token-context";
import { signalOutcome } from "./signals";

export async function generateSignals(now = Date.now()) {
  const db = await getDb();
  const candidates = await db.select({ address: schema.tokens.address }).from(schema.tokens).where(gte(schema.tokens.lastActivityAt, new Date(now - 3_600_000))).orderBy(desc(schema.tokens.lastActivityAt)).limit(100);
  const indexed = await db.selectDistinct({ address: schema.chainSwaps.tokenAddress }).from(schema.chainSwaps).where(gte(schema.chainSwaps.timestamp, new Date(now - 3_600_000))).limit(100);
  let saved = 0;
  for (const address of new Set([...candidates, ...indexed].map(t => t.address))) {
    const context = await tokenContext(address, now);
    if (!context?.runner.eligible) continue;
    const signal = context.runner;
    const row = { id: `${address}:${Math.floor(now / 900_000)}:${signal.signalType}`, token: address, timestamp: new Date(now), runnerScore: signal.score,
      smartMoneyScore: context.consensus.score, momentumScore: signal.components.find(c => c.key === 'momentum')?.value,
      holderScore: signal.components.find(c => c.key === 'holders')?.value, liquidityScore: signal.components.find(c => c.key === 'liquidity')?.value,
      riskPenalty: signal.riskPenalty, narrativeScore: null, finalScore: signal.score, signalType: signal.signalType, reasons: signal.reasons, inputs: context, version: signal.version };
    const inserted = await db.insert(schema.tokenSignals).values(row).onConflictDoNothing().returning({ id: schema.tokenSignals.id });
    saved += inserted.length;
  }
  return saved;
}

export async function updateSignalOutcomes(now = Date.now()) {
  const db = await getDb();
  const signals = await db.select().from(schema.tokenSignals).where(and(gte(schema.tokenSignals.timestamp, new Date(now - 48 * 3_600_000)), lte(schema.tokenSignals.timestamp, new Date(now - 300_000)))).orderBy(desc(schema.tokenSignals.timestamp)).limit(2000);
  let count = 0;
  for (const signal of signals) {
    const input = signal.inputs as TokenIntelligence;
    if (input.price == null || input.price <= 0) continue;
    const observations = await db.select().from(schema.marketObservations).where(and(eq(schema.marketObservations.tokenAddress, signal.token), gte(schema.marketObservations.timestamp, signal.timestamp), lte(schema.marketObservations.timestamp, new Date(Math.min(now, signal.timestamp.getTime() + 86_490_000))))).orderBy(schema.marketObservations.timestamp);
    const points = observations.filter(o => o.priceUsd != null && o.priceUsd > 0).map(o => ({ timestamp: o.timestamp.getTime(), price: o.priceUsd! }));
    const outcomes = [300_000, 900_000, 3_600_000, 21_600_000, 86_400_000].map(horizon => signalOutcome({ timestamp: signal.timestamp.getTime(), price: input.price! }, points, horizon, now));
    const row = { signalId: signal.id, return5m: outcomes[0]?.returnPct, return15m: outcomes[1]?.returnPct, return1h: outcomes[2]?.returnPct, return6h: outcomes[3]?.returnPct, return24h: outcomes[4]?.returnPct,
      maxGain1h: outcomes[2]?.maxGain, maxGain6h: outcomes[3]?.maxGain, maxGain24h: outcomes[4]?.maxGain, maxDrawdown1h: outcomes[2]?.maxDrawdown, maxDrawdown24h: outcomes[4]?.maxDrawdown,
      calculatedAt: new Date(now), coverage: { horizons: outcomes, method: 'point-in-time stored signal inputs; later observed price samples' } };
    await db.insert(schema.signalOutcomes).values(row).onConflictDoUpdate({ target: schema.signalOutcomes.signalId, set: row }); count++;
  }
  return count;
}

export async function listRadar(limit = 30, now = Date.now()) {
  const db = await getDb();
  const rows = await db.selectDistinctOn([schema.tokenSignals.token]).from(schema.tokenSignals).where(gte(schema.tokenSignals.timestamp, new Date(now - 1_800_000))).orderBy(schema.tokenSignals.token, desc(schema.tokenSignals.timestamp));
  return rows.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0)).slice(0, limit).map(s => ({ id: s.id, at: s.timestamp.toISOString(), type: s.signalType, score: s.finalScore, context: s.inputs as TokenIntelligence }));
}

export async function signalPerformance(days = 30, minimumScore = 0) {
  const db = await getDb();
  const rows = await db.select({ signal: schema.tokenSignals, outcome: schema.signalOutcomes }).from(schema.tokenSignals).leftJoin(schema.signalOutcomes, eq(schema.signalOutcomes.signalId, schema.tokenSignals.id))
    .where(and(gte(schema.tokenSignals.timestamp, new Date(Date.now() - days * 86_400_000)), sql`${schema.tokenSignals.finalScore} >= ${minimumScore}`)).orderBy(desc(schema.tokenSignals.timestamp)).limit(2000);
  return rows.map(r => ({ ...r.signal, timestamp: r.signal.timestamp.toISOString(), outcome: r.outcome, context: r.signal.inputs as TokenIntelligence }));
}
