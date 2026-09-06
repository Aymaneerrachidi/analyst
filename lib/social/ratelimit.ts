import "server-only";
import { and, count, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";

const { posts, comments, ratings, votes } = schema;

export type LimitedAction = "post" | "comment" | "rating" | "vote";

interface Bucket {
  hits: number[];
}

type LimiterState = { buckets: Map<string, Bucket>; lastSweep: number };
const g = globalThis as unknown as { __analystLimiter?: LimiterState };
const memory: LimiterState = g.__analystLimiter ?? (g.__analystLimiter = { buckets: new Map(), lastSweep: Date.now() });

function windowFor(action: LimitedAction): { windowMs: number; limit: number } {
  const e = env();
  switch (action) {
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
