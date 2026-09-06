import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { RatingSummary } from "@/lib/types";
import { isMockProvider } from "@/lib/env";

const { ratings } = schema;

export type RatingTarget = "token" | "trader";

export interface RatingAggregate {
  average: number | null;
  count: number;
}

export async function getRatingAggregates(targetType: RatingTarget, ids: string[]): Promise<Map<string, RatingAggregate>> {
  const out = new Map<string, RatingAggregate>();
  if (ids.length === 0) return out;
  const db = await getDb();
  const rows = await db
    .select({
      targetId: ratings.targetId,
      average: sql<number>`avg(${ratings.score})::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(ratings)
    .where(and(eq(ratings.targetType, targetType), inArray(ratings.targetId, ids), isMockProvider() ? undefined : inArray(ratings.guestId, db.select({ id: schema.guests.id }).from(schema.guests).where(eq(schema.guests.isSeed, false)))))
    .groupBy(ratings.targetId);
  for (const r of rows) {
    out.set(r.targetId, { average: r.average === null ? null : Number(r.average), count: Number(r.count) });
  }
  return out;
}

export async function getRatingSummary(targetType: RatingTarget, targetId: string, guestId: string | null): Promise<RatingSummary> {
  const db = await getDb();
  const rows = await db
    .select({ score: ratings.score, n: sql<number>`count(*)::int` })
    .from(ratings)
    .where(and(eq(ratings.targetType, targetType), eq(ratings.targetId, targetId), isMockProvider() ? undefined : inArray(ratings.guestId, db.select({ id: schema.guests.id }).from(schema.guests).where(eq(schema.guests.isSeed, false)))))
    .groupBy(ratings.score);
  const distribution = Array.from({ length: 10 }, () => 0);
  let total = 0;
  let sum = 0;
  for (const r of rows) {
    const n = Number(r.n);
    distribution[r.score - 1] = n;
    total += n;
    sum += n * r.score;
  }
  let mine: number | null = null;
  if (guestId) {
    const [m] = await db
      .select({ score: ratings.score })
      .from(ratings)
      .where(and(eq(ratings.targetType, targetType), eq(ratings.targetId, targetId), eq(ratings.guestId, guestId)))
      .limit(1);
    mine = m?.score ?? null;
  }
  return {
    targetType,
    targetId,
    average: total > 0 ? sum / total : null,
    count: total,
    mine,
    distribution,
  };
}

export async function upsertRating(guestId: string, targetType: RatingTarget, targetId: string, score: number): Promise<void> {
  const db = await getDb();
  await db
    .insert(ratings)
    .values({ id: `r_${randomBytes(8).toString("hex")}`, guestId, targetType, targetId, score })
    .onConflictDoUpdate({
      target: [ratings.guestId, ratings.targetType, ratings.targetId],
      set: { score, updatedAt: new Date() },
    });
}
