import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/** Lease outlives the 300-second function limit; a killed invocation recovers automatically. */
export async function acquireSyncLease(): Promise<(() => Promise<void>) | null> {
  const db = await getDb();
  const key = "lock:ingestion";
  const owner = randomUUID();
  const rows = await db.insert(schema.appMeta).values({ key, value: { owner } })
    .onConflictDoUpdate({ target: schema.appMeta.key, set: { value: { owner }, updatedAt: new Date() },
      setWhere: sql`${schema.appMeta.updatedAt} < now() - interval '6 minutes'` })
    .returning({ key: schema.appMeta.key });
  if (!rows.length) return null;
  return async () => {
    await db.delete(schema.appMeta).where(and(eq(schema.appMeta.key, key), sql`${schema.appMeta.value}->>'owner' = ${owner}`));
  };
}
