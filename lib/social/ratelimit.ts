import "server-only";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";

const { posts, comments, ratings, votes } = schema;

export type LimitedAction = "post" | "comment" | "rating" | "vote" | "identity" | "report" | "research" | "preferences";

interface Bucket {
  hits: number[];
}

type LimiterState = { buckets: Map<string, Bucket>; lastSweep: number };
const g = globalThis as unknown as { __analystLimiter?: LimiterState };
const memory: LimiterState = g.__analystLimiter ?? (g.__analystLimiter = { buckets: new Map(), lastSweep: Date.now() });

function windowFor(action: LimitedAction): { windowMs: number; limit: number } {
  const e = env();
  switch (action) {
    case "research":
      return { windowMs: 60 * 60_000, limit: 12 };
    case "preferences":
      return { windowMs: 10 * 60_000, limit: 60 };
    case "identity":
    case "report":
      return { windowMs: 60 * 60_000, limit: 10 };
    case "post":
      return { windowMs: 10 * 60_000, limit: e.RATE_LIMIT_POSTS_PER_10M };
    case "comment":
      return { windowMs: 10 * 60_000, limit: e.RATE_LIMIT_COMMENTS_PER_10M };
    case "rating":
      return { windowMs: 60 * 60_000, limit: e.RATE_LIMIT_RATINGS_PER_HOUR };
    case "vote":
      return { windowMs: 60 * 60_000, limit: e.RATE_LIMIT_VOTES_PER_HOUR };
  }
}

/** Atomic shared budget: parallel requests and new cookies cannot reset the IP quota. */
export async function consumeWriteBudget(identity: string, action: LimitedAction, multiplier = 1, now = Date.now()) {
  const db = await getDb();
  const { windowMs, limit } = windowFor(action);
  const bucket = Math.floor(now / windowMs);
  const key = `rate:${action}:${identity}:${bucket}`;
  const rows = await db.insert(schema.appMeta).values({ key, value: { count: 1 }, updatedAt: new Date(now) })
    .onConflictDoUpdate({ target: schema.appMeta.key,
      set: { value: sql`jsonb_build_object('count', (${schema.appMeta.value}->>'count')::int + 1)`, updatedAt: new Date(now) },
      setWhere: sql`(${schema.appMeta.value}->>'count')::int < ${limit * multiplier}`,
    }).returning({ key: schema.appMeta.key });
  return { ok: rows.length === 1, retryAfterSec: Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000)), limit: limit * multiplier };
}

function sweep(now: number): void {
  if (now - memory.lastSweep < 60_000) return;
  memory.lastSweep = now;
  for (const [key, bucket] of memory.buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < 60 * 60_000);
    if (bucket.hits.length === 0) memory.buckets.delete(key);
  }
}

/** Process-local sliding window, keyed by hashed IP. First line of defence; not authoritative. */
export function checkIpLimit(ipHash: string | null, action: LimitedAction): { ok: boolean; retryAfterSec: number } {
  if (!ipHash) return { ok: true, retryAfterSec: 0 };
  const now = Date.now();
  sweep(now);
  const { windowMs, limit } = windowFor(action);
  const key = `${action}:${ipHash}`;
  const bucket = memory.buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  // IP limit is looser than the per-guest limit because many people can share one address.
  const ipLimit = limit * 3;
  if (bucket.hits.length >= ipLimit) {
    const retryAfter = Math.ceil((bucket.hits[0] + windowMs - now) / 1000);
    return { ok: false, retryAfterSec: Math.max(retryAfter, 1) };
  }
  bucket.hits.push(now);
  memory.buckets.set(key, bucket);
  return { ok: true, retryAfterSec: 0 };
}

/** Durable per-guest window counted from the database, so limits hold across instances. */
export async function checkGuestLimit(guestId: string, action: LimitedAction): Promise<{ ok: boolean; retryAfterSec: number; limit: number }> {
  const db = await getDb();
  const { windowMs, limit } = windowFor(action);
  const since = new Date(Date.now() - windowMs);
  let n = 0;
  switch (action) {
    case "post": {
      const [r] = await db.select({ n: count() }).from(posts).where(and(eq(posts.guestId, guestId), gt(posts.createdAt, since)));
      n = Number(r?.n ?? 0);
      break;
    }
    case "comment": {
      const [r] = await db.select({ n: count() }).from(comments).where(and(eq(comments.guestId, guestId), gt(comments.createdAt, since)));
      n = Number(r?.n ?? 0);
      break;
    }
    case "rating": {
      const [r] = await db.select({ n: count() }).from(ratings).where(and(eq(ratings.guestId, guestId), gt(ratings.updatedAt, since)));
      n = Number(r?.n ?? 0);
      break;
    }
    case "vote": {
      const [r] = await db.select({ n: count() }).from(votes).where(and(eq(votes.guestId, guestId), gt(votes.updatedAt, since)));
      n = Number(r?.n ?? 0);
      break;
    }
  }
  if (n >= limit) return { ok: false, retryAfterSec: Math.ceil(windowMs / 1000), limit };
  return { ok: true, retryAfterSec: 0, limit };
}

/** Minimum spacing between consecutive comments/posts from the same guest. */
export async function checkCooldown(guestId: string, kind: "post" | "comment"): Promise<{ ok: boolean; retryAfterSec: number }> {
  const cooldown = env().COMMENT_COOLDOWN_SECONDS * 1000;
  if (cooldown <= 0) return { ok: true, retryAfterSec: 0 };
  const db = await getDb();
  const since = new Date(Date.now() - cooldown);
  const table = kind === "post" ? posts : comments;
  const [r] = await db
    .select({ n: count() })
    .from(table)
    .where(and(eq(table.guestId, guestId), gt(table.createdAt, since)));
  if (Number(r?.n ?? 0) > 0) return { ok: false, retryAfterSec: Math.ceil(cooldown / 1000) };
  return { ok: true, retryAfterSec: 0 };
}
