import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, notInArray } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { getGuest } from '@/lib/social/guest';
import { guardWrite } from '@/lib/social/write-guard';
import { noStore, parseJson } from '@/lib/api';
import { addressSchema } from '@/lib/trading/shared';
import { alertRuleSchema } from '@/lib/client/tracking-model';
const input = z.object({ follows: z.array(addressSchema).max(100).optional(), watchlist: z.array(addressSchema).max(200).optional(), rules: z.array(alertRuleSchema).max(30).optional() }).strict();
export async function GET() {
  const guest = await getGuest();
  if (!guest) return NextResponse.json({ follows: [], watchlist: [], rules: [], saved: false }, noStore);
  const db = await getDb();
  const [[preferences], rules] = await Promise.all([db.select().from(schema.userPreferences).where(eq(schema.userPreferences.guestId, guest.id)).limit(1), db.select().from(schema.alertRules).where(eq(schema.alertRules.guestId, guest.id))]);
  return NextResponse.json({ follows: preferences?.follows ?? [], watchlist: preferences?.watchlist ?? [], rules: rules.map(r => r.config), saved: Boolean(preferences) }, noStore);
}
export async function PATCH(req: Request) {
  const parsed = await parseJson(req, input); if (!parsed.ok) return parsed.response;
  const guard = await guardWrite(req, 'preferences'); if (!guard.ok) return guard.response;
  const guestId = guard.ctx.guest.id, db = await getDb(), body = parsed.data;
  await db.transaction(async tx => {
    await tx.insert(schema.userPreferences).values({ guestId }).onConflictDoNothing();
    await tx.update(schema.userPreferences).set({ ...(body.follows ? { follows: [...new Set(body.follows)] } : {}), ...(body.watchlist ? { watchlist: [...new Set(body.watchlist)] } : {}), updatedAt: new Date() }).where(eq(schema.userPreferences.guestId, guestId));
    if (body.rules) {
      const ids = body.rules.map(r => `${guestId}:${r.id}`);
      await tx.delete(schema.alertRules).where(and(eq(schema.alertRules.guestId, guestId), ids.length ? notInArray(schema.alertRules.id, ids) : undefined));
      for (const rule of body.rules) {
        const row = { id: `${guestId}:${rule.id}`, guestId, alertType: 'trade', trader: rule.scope === 'wallet' ? rule.wallet : null, token: /^0x[\da-f]{40}$/i.test(rule.token) ? rule.token.toLowerCase() : null, threshold: rule.minUsd, enabled: rule.enabled, destination: 'browser', config: rule };
        await tx.insert(schema.alertRules).values(row).onConflictDoUpdate({ target: schema.alertRules.id, set: row });
      }
    }
  });
  return NextResponse.json({ saved: true }, noStore);
}
