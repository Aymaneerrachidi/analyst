import { desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import type { Freshness } from '@/lib/types';

export async function webhookFreshness(): Promise<Freshness> {
  const provider = process.env.LIVE_FEED_SOURCE === 'stalkchain' ? 'stalkchain' : 'alchemy';
  const db = await getDb();
  const [row] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, provider === 'stalkchain' ? 'stalkchain-worker' : 'alchemy-worker'));
  const state = row?.value as { at?: string; status?: string; active?: boolean } | undefined;
  const [latest] = await db.select({ at: schema.trades.timestamp }).from(schema.trades).orderBy(desc(schema.trades.timestamp)).limit(1);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.traders);
  const ageMs = state?.at ? Date.now() - Date.parse(state.at) : null;
  const live = ageMs !== null && ageMs < 30_000 && state?.status === 'live' && (provider === 'stalkchain' || state.active === true);
  return { provider, isMock: false, checkedAt: new Date().toISOString(), lastTradeAt: latest?.at.toISOString() ?? null, tradeAgeMs: latest ? Date.now() - latest.at.getTime() : null, lastSyncAt: state?.at ?? null, ageMs, lastSyncOk: live, status: live ? 'live' : ageMs !== null && ageMs < 90_000 ? 'delayed' : 'offline', trackedTraders: count };
}
