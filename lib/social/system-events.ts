import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gte, lt, sql, desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { cleanSymbol } from "@/lib/presentation";
import { isMockProvider } from "@/lib/env";

/** One notable, completed 30-minute interval per sync; only recorded transactions count. */
export async function publishSystemEvent(now = Date.now()): Promise<number> {
  if (isMockProvider()) return 0;
  const db = await getDb();
  const { trades, tokens, guests, posts, appMeta } = schema;
  const end = Math.floor(now / 1_800_000) * 1_800_000;
  const start = end - 1_800_000;
  await db.delete(appMeta).where(and(sql`${appMeta.key} like 'rate:%'`, lt(appMeta.updatedAt, new Date(now - 172_800_000))));
  // The interval key ensures later arrivals cannot create multiple summaries for the same window.
  const id = `event_${end}`;
  const [exists] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1);
  if (exists) return 0;
  const net = sql<number>`sum(case when ${trades.side} = 'BUY' then ${trades.amountUsd} else -${trades.amountUsd} end)`;
  const buyers = sql<number>`count(distinct case when ${trades.side} = 'BUY' then ${trades.traderId} end)`;
  const [event] = await db.select({ address: tokens.address, symbol: tokens.symbol, net, buyers,
    records: sql<number>`count(*)`, missing: sql<number>`count(*) filter (where ${trades.amountUsd} is null)` })
    .from(trades).innerJoin(tokens, eq(tokens.address, trades.tokenAddress))
    .where(and(gte(trades.timestamp, new Date(start)), lt(trades.timestamp, new Date(end))))
    .groupBy(tokens.address, tokens.symbol)
    .having(sql`${buyers} >= 3 and ${net} >= 1000 and count(*) filter (where ${trades.amountUsd} is null) = 0`)
    .orderBy(desc(net), tokens.address).limit(1);
  if (!event) return 0;
  const symbol = cleanSymbol(event.symbol);
  const body = `${event.buyers} tracked traders bought $${symbol} during ${new Date(start).toISOString()} to ${new Date(end).toISOString()}. Recorded buy value minus sell value: $${Number(event.net).toLocaleString("en-US", { maximumFractionDigits: 2 })} across ${event.records} transactions. Partial tracked coverage; this is an activity summary, not a price forecast.`;
  return db.transaction(async tx => {
    await tx.insert(guests).values({ id: "g_analyst_system", displayName: "Analyst", tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"), isSeed: false }).onConflictDoNothing();
    const inserted = await tx.insert(posts).values({ id, guestId: "g_analyst_system", body, bodyHash: createHash("sha256").update(body).digest("hex"), createdAt: new Date(end) }).onConflictDoNothing().returning({ id: posts.id });
    if (inserted.length) await tx.insert(appMeta).values({ key: `system:${id}`, value: { address: event.address, symbol, start, end, records: Number(event.records), net: Number(event.net) } }).onConflictDoNothing();
    return inserted.length;
  });
}
