import 'server-only';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { sharedLoad } from '@/lib/v2/shared-cache';
const address = z.string().regex(/^0x[\da-f]{40}$/i).transform(v => v.toLowerCase());
const integer = z.string().regex(/^\d+$/);
const tokenSchema = z.object({ token: z.object({ address, total_supply: integer, liquidity_usd: z.string().nullable().optional(), market_updated: z.string().nullable().optional(), image_url: z.string().url().nullable().optional() }) });
const holdersSchema = z.object({ standard: z.literal(20), computedAt: z.number().finite(), incomplete: z.boolean(), holders: z.array(z.object({ holder: address, balance: integer })).max(1000) });
export async function hoodTokenEvidence(token: string) {
  address.parse(token);
  return sharedLoad(`hood:evidence:v2:${token}`, 300_000, async () => {
    const db = await getDb();
    // A conservative application cap, shared by all visitors: six token checks
    // (12 requests) per minute. No unbounded scanning or historical backfill.
    const key = 'hood:minute-budget';
    const minute = Math.floor(Date.now() / 60_000);
    const claim = await db.insert(schema.appMeta).values({ key, value: { minute, count: 1 } }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value: sql`jsonb_build_object('minute', ${minute}::bigint, 'count', case when (${schema.appMeta.value}->>'minute')::bigint = ${minute} then (${schema.appMeta.value}->>'count')::int + 1 else 1 end)` }, setWhere: sql`(${schema.appMeta.value}->>'minute')::bigint <> ${minute} or (${schema.appMeta.value}->>'count')::int < 6` }).returning({ key: schema.appMeta.key });
    if (!claim.length) throw new Error('Explorer budget used');
    async function get(path: string) {
      const r = await fetch(`https://api.hoodexplorer.io/api/token/${token}${path}`, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!r.ok) throw new Error('Explorer unavailable');
      return r.json();
    }
    const rawMetadata = await get('');
    const parsed = tokenSchema.safeParse(rawMetadata);
    if (!parsed.success) { console.error('[hood:schema]', parsed.error.issues.map(i => ({ path: i.path, code: i.code }))); throw new Error('Invalid explorer metadata'); }
    const metadata = parsed.data;
    if (metadata.token.address !== token.toLowerCase()) throw new Error('Token mismatch');
    const holders = holdersSchema.parse(await get('/holders'));
    const marketAt = Number(metadata.token.market_updated);
    const liquidity = Number(metadata.token.liquidity_usd);
    return { holderObservedAt: new Date(holders.computedAt).toISOString(), holderIncomplete: holders.incomplete, supply: metadata.token.total_supply, holders: holders.holders.map(h => ({ address: h.holder, raw: h.balance })), liquidity: metadata.token.liquidity_usd != null && Number.isFinite(liquidity) && liquidity >= 0 && marketAt <= Date.now() + 60_000 && Date.now() - marketAt < 600_000 ? liquidity : null, image: metadata.token.image_url ?? null };
  });
}
