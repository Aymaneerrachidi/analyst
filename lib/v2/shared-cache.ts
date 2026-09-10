import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
export type CachedResult<T> = { data: T | null; observedAt: string | null; stale: boolean; status: 'ready' | 'pending' | 'unavailable' };

/** A DB-backed cache and lease, shared by all browser requests and worker instances. */
export async function sharedLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>, now = Date.now()): Promise<CachedResult<T>> {
  const db = await getDb();
  const [row] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, `shared:${key}`)).limit(1);
  const cached = row?.value as { data: T | null; observedAt: string | null; expiresAt: number; error?: boolean } | undefined;
  if (cached && cached.expiresAt > now) return { data: cached.data, observedAt: cached.observedAt, stale: Boolean(cached.error), status: cached.error ? 'unavailable' : 'ready' };
  const owner = randomUUID(), lock = `lock:shared:${key}`;
  const claimed = await db.insert(schema.appMeta).values({ key: lock, value: { owner }, updatedAt: new Date(now) }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value: { owner }, updatedAt: new Date(now) }, setWhere: sql`${schema.appMeta.updatedAt} < ${new Date(now - 60_000).toISOString()}::timestamptz` }).returning({ key: schema.appMeta.key });
  if (!claimed.length) return { data: cached?.data ?? null, observedAt: cached?.observedAt ?? null, stale: true, status: 'pending' };
  try {
    const data = await loader();
    const observedAt = new Date().toISOString();
    await db.insert(schema.appMeta).values({ key: `shared:${key}`, value: { data, observedAt, expiresAt: Date.now() + ttlMs } }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value: { data, observedAt, expiresAt: Date.now() + ttlMs }, updatedAt: new Date() } });
    return { data, observedAt, stale: false, status: 'ready' };
  } catch {
    await db.insert(schema.appMeta).values({ key: `shared:${key}`, value: { data: cached?.data ?? null, observedAt: cached?.observedAt ?? null, expiresAt: Date.now() + 30_000, error: true } }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value: { data: cached?.data ?? null, observedAt: cached?.observedAt ?? null, expiresAt: Date.now() + 30_000, error: true }, updatedAt: new Date() } });
    return { data: cached?.data ?? null, observedAt: cached?.observedAt ?? null, stale: true, status: 'unavailable' };
  } finally { await db.delete(schema.appMeta).where(and(eq(schema.appMeta.key, lock), sql`${schema.appMeta.value}->>'owner' = ${owner}`)); }
}
