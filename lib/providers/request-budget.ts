import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

/** Shared across Vercel instances, so new visitors cannot multiply free API calls. */
export async function reserveProviderRequest(provider: string, perMinute: number): Promise<boolean> {
  if (process.env.NODE_TEST_CONTEXT) return true;
  const db = await getDb();
  const minute = Math.floor(Date.now() / 60_000);
  const rows = await db.insert(schema.appMeta).values({ key: `budget:provider:${provider}`, value: { minute, count: 1 } })
    .onConflictDoUpdate({ target: schema.appMeta.key, set: {
      value: sql`jsonb_build_object('minute', ${minute}::bigint, 'count', case when (${schema.appMeta.value}->>'minute')::bigint = ${minute} then (${schema.appMeta.value}->>'count')::int + 1 else 1 end)`, updatedAt: new Date(),
    }, setWhere: sql`(${schema.appMeta.value}->>'minute')::bigint <> ${minute} or (${schema.appMeta.value}->>'count')::int < ${perMinute}` }).returning({ key: schema.appMeta.key });
  return rows.length === 1;
}
