import "server-only";
import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import { assessTokenRisk } from "@/lib/intelligence/risk";
import { refreshPositions } from "@/lib/intelligence/positions";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { fetchMarketQuotes } from "@/lib/providers/market-data";
import { v2Config } from "./config";
import { logEvent } from "./log";
import { refreshWalletMetrics } from "@/lib/intelligence/service";
import { generateSignals, updateSignalOutcomes } from "@/lib/intelligence/signal-store";
import { deliverAlerts } from '@/lib/intelligence/alerts';
import { discoverExistingPools } from '@/lib/indexer/discovery';

/** Central scheduled enrichment. No browser triggers this scan or paid research. */
export async function captureMarketObservations() {
  const db = await getDb();
  const config = v2Config();
  const [active, inventory, rotation] = await Promise.all([
    db.select({ address: schema.tokens.address }).from(schema.tokens).orderBy(desc(schema.tokens.lastActivityAt)).limit(100),
    db.select({ address: schema.tokens.address }).from(schema.tokens).orderBy(schema.tokens.address).limit(20000),
    db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'v2:market-rotation')).limit(1),
  ]);
  const offset = Number((rotation[0]?.value as { offset?: number } | undefined)?.offset ?? 0) % Math.max(1, inventory.length);
  const sweep = [...inventory.slice(offset), ...inventory.slice(0, offset)].slice(0, 100);
  const tokens = [...active, ...sweep];
  await db.insert(schema.appMeta).values({ key: 'v2:market-rotation', value: { offset: offset + sweep.length, total: inventory.length } }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value: { offset: offset + sweep.length, total: inventory.length }, updatedAt: new Date() } });
  const addresses = [...new Set([...tokens.map(t => t.address), ...config.usdQuotes, ...(config.WRAPPED_NATIVE_ADDRESS ? [config.WRAPPED_NATIVE_ADDRESS] : [])])];
  const quotes = await fetchMarketQuotes(addresses);
  // Observation time is after fetching; never backdate data to a bucket boundary.
  let count = 0;
  for (const [tokenAddress, quote] of quotes) {
    if (quote.price == null || !Number.isFinite(quote.price) || quote.price <= 0) continue;
    const timestamp = quote.observedAt ? new Date(quote.observedAt) : new Date();
    await db.insert(schema.marketObservations).values({ tokenAddress, timestamp, source: quote.source ?? "market provider", priceUsd: quote.price, marketCap: quote.marketCap, fdv: quote.fdv,
      liquidityUsd: quote.liquidityUsd > 0 ? quote.liquidityUsd : null, volume5m: quote.volume5m, volume1h: quote.volume1h, volume6h: quote.volume6h, volume24h: quote.volume24h,
      priceChange5m: quote.priceChange5m, priceChange1h: quote.priceChange1h, buys5m: quote.buys5m, sells5m: quote.sells5m,
      completeness: { holders: "unknown", prices: "observed quote", marketCap: quote.marketCap != null ? "reported token valuation" : "unknown" },
    }).onConflictDoNothing();
    await db.update(schema.tokens).set({ price: quote.price, marketCap: quote.marketCap, fdv: quote.fdv, volume24h: quote.volume24h, priceChange24h: quote.priceChange24h, updatedAt: timestamp }).where(eq(schema.tokens.address, tokenAddress));
    count++;
  }
  logEvent("DEXSCREENER", "snapshots_captured", { count });
  return count;
}

export async function runPipeline() {
  const db = await getDb(), owner = randomUUID(), started = Date.now();
  const claimed = await db.insert(schema.appMeta).values({ key: 'lock:analytics', value: { owner } }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value: { owner }, updatedAt: new Date() }, setWhere: sql`${schema.appMeta.updatedAt} < now() - interval '15 minutes'` }).returning({ key: schema.appMeta.key });
  if (!claimed.length) return { skipped: true };
  const results: Record<string, { status: string; count?: number; durationMs: number }> = {};
  async function stage(name: string, work: () => Promise<number>) {
    const at = Date.now();
    try { results[name] = { status: 'ready', count: await work(), durationMs: Date.now() - at }; }
    catch { results[name] = { status: 'unavailable', durationMs: Date.now() - at }; logEvent('SIGNALS', 'stage_failed', { stage: name }); }
  }
  try {
    if (process.env.DATA_PROVIDER === 'kolhood') await stage('importedHistory', async () => {
      const { runSync } = await import('@/lib/services/sync');
      const [last] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'v2:legacy-full')).limit(1);
      const full = !last || Date.now() - last.updatedAt.getTime() > 900_000;
      const result = await runSync(full ? 'full' : 'trades');
      if (full) await db.insert(schema.appMeta).values({ key: 'v2:legacy-full', value: { at: new Date().toISOString() } }).onConflictDoUpdate({ target: schema.appMeta.key, set: { updatedAt: new Date() } });
      return result.tradesUpserted;
    });
    await stage('markets', captureMarketObservations);
    await stage('poolDiscovery', discoverExistingPools);
    await stage('charts', async () => {
      const { getTokenChart } = await import('@/lib/services/token-chart');
      const requests = await db.select().from(schema.appMeta).where(sql`${schema.appMeta.key} like 'demand:chart:%'`).orderBy(schema.appMeta.updatedAt).limit(8);
      const active = await db.select({ address: schema.tokens.address }).from(schema.tokens).orderBy(desc(schema.tokens.lastActivityAt)).limit(3);
      const jobs = [...requests.map(r => ({ key: r.key, ...(r.value as { address: string; window: '1h' | '6h' | '24h' | '7d' }) })), ...active.map(t => ({ key: '', address: t.address, window: '24h' as const }))];
      let count = 0;
      for (const job of jobs) {
        try { await getTokenChart(job.address, job.window); count++; if (job.key) await db.delete(schema.appMeta).where(eq(schema.appMeta.key, job.key)); }
        catch { logEvent('DEXSCREENER', 'chart_failed'); }
      }
      return count;
    });
    await stage('wallets', refreshWalletMetrics);
    await stage('risk', async () => {
      const tokens = await db.select({ address: schema.tokens.address }).from(schema.tokens).leftJoin(schema.riskAssessments, eq(schema.riskAssessments.token, schema.tokens.address)).groupBy(schema.tokens.address).orderBy(sql`max(${schema.riskAssessments.timestamp}) asc nulls first`).limit(5);
      let count = 0;
      for (const token of tokens) { const result = await assessTokenRisk(token.address as Address); if (result.status === 'ready') count++; }
      return count;
    });
    await stage('positions', async () => {
      const wallets = await db.select({ wallet: schema.userPositions.wallet }).from(schema.userPositions).groupBy(schema.userPositions.wallet).orderBy(sql`min(${schema.userPositions.updatedAt}) asc`).limit(5);
      for (const { wallet } of wallets) await refreshPositions(wallet as Address);
      return wallets.length;
    });
    await stage('signals', generateSignals);
    await stage('outcomes', updateSignalOutcomes);
    await stage('alerts', deliverAlerts);
    const value = { at: new Date().toISOString(), stages: results, durationMs: Date.now() - started };
    await db.insert(schema.appMeta).values({ key: 'v2:pipeline', value }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt: new Date() } });
    return results;
  } finally { await db.delete(schema.appMeta).where(sql`${schema.appMeta.key} = 'lock:analytics' and ${schema.appMeta.value}->>'owner' = ${owner}`); }
}
