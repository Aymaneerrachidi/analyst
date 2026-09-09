import 'server-only';
import { createHash } from 'node:crypto';
import { desc, eq, gte } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { indexedTradeSnapshot, storedTradeSnapshot } from './live';
import { matchesAlert, alertRuleSchema } from '@/lib/client/tracking-model';
import { mergeLiveTrades } from '@/lib/client/live-trades';
export async function deliverAlerts(now = Date.now()) {
  const db = await getDb();
  const [rules, indexed, imported] = await Promise.all([db.select({ rule: schema.alertRules, preferences: schema.userPreferences }).from(schema.alertRules).innerJoin(schema.userPreferences, eq(schema.userPreferences.guestId, schema.alertRules.guestId)).where(eq(schema.alertRules.enabled, true)).limit(5000), indexedTradeSnapshot(500), storedTradeSnapshot(200)]);
  const trades = mergeLiveTrades(imported, indexed, 700); let count = 0;
  for (const { rule, preferences } of rules) {
    const parsed = alertRuleSchema.safeParse(rule.config); if (!parsed.success) continue;
    const follows = (preferences.follows as string[]).map(id => ({ id, wallet: id, name: id, handle: id }));
    const matches = trades.filter(t => matchesAlert(t, parsed.data, follows, now));
    // One delivery per closed minute; late confirmed fills update that same delivery.
    const groups = new Map<string, typeof trades>();
    for (const trade of matches) { const bucket = Math.floor(Date.parse(trade.timestamp) / 60_000); if ((bucket + 1) * 60_000 > now - 15_000) continue; const key = `${trade.traderId}:${trade.token.address}:${trade.side}:${bucket}`; groups.set(key, [...(groups.get(key) ?? []), trade]); }
    for (const [eventKey, rows] of groups) {
      const id = createHash('sha256').update(`${rule.id}:${eventKey}`).digest('hex');
      const payload = { kind: 'trade', title: parsed.data.name, trader: rows[0].trader, token: rows[0].token, side: rows[0].side, count: rows.length, amountUsd: rows.every(t => t.amountUsd != null) ? rows.reduce((s, t) => s + t.amountUsd!, 0) : null, transactions: [...new Set(rows.map(t => t.txHash).filter(Boolean))], observedAt: rows[0].timestamp, coverage: 'available monitored trades; grouped completed minute' };
      const inserted = await db.insert(schema.alertDeliveries).values({ id, ruleId: rule.id, guestId: rule.guestId, eventKey, payload, createdAt: new Date(now) }).onConflictDoUpdate({ target: schema.alertDeliveries.id, set: { payload } }).returning({ id: schema.alertDeliveries.id }); count += inserted.length;
    }
  }
  return count;
}
export async function alertInbox(guestId: string) { const db = await getDb(); return db.select().from(schema.alertDeliveries).where(eq(schema.alertDeliveries.guestId, guestId)).orderBy(desc(schema.alertDeliveries.createdAt)).limit(100); }
export async function recentFollowedSignals(addresses: string[]) { if (!addresses.length) return []; const db = await getDb(); const rows = await db.select().from(schema.tokenSignals).where(gte(schema.tokenSignals.timestamp, new Date(Date.now() - 86_400_000))).orderBy(desc(schema.tokenSignals.timestamp)).limit(200); return rows.filter(r => addresses.includes(r.token)); }
