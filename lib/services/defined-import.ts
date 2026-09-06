import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { normalizeDefinedImport, sourceNumber } from "@/lib/providers/defined-import";
import { insertTrades, recomputeDerived, upsertTokens, upsertTraders } from "./sync";
import { acquireSyncLease } from "./sync-lock";

export async function importDefinedSnapshot(walletInput: unknown, historyInput: unknown) {
  const input = normalizeDefinedImport(walletInput, historyInput);
  const db = await getDb();
  const release = await acquireSyncLease();
  if (!release) throw new Error("An ingestion job is already running; retry after it finishes.");
  try {
    const existing = await db.select({ id: schema.traders.id }).from(schema.traders);
    const existingIds = new Set(existing.map((t) => t.id));
    const capturedAt = new Date(input.capturedAt);
    // Existing identities retain their preferred name; fill only absent photos.
    await upsertTraders(db, input.traders.filter((t) => !existingIds.has(t.wallet)));
    for (const t of input.traders.filter((t) => existingIds.has(t.wallet))) {
      await db.update(schema.traders).set({ avatar: sql`coalesce(${schema.traders.avatar}, ${t.avatar ?? null})`, twitterUrl: sql`coalesce(${schema.traders.twitterUrl}, ${t.twitterUrl ?? null})` }).where(eq(schema.traders.id, t.wallet));
    }
    await upsertTokens(db, input.tokens);
    const inserted = await insertTrades(db, input.trades);
    for (const w of input.wallets) {
      const key = `defined:wallet:${w.address}`;
      const [previous] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, key));
      if (previous && previous.updatedAt > capturedAt) continue;
      const ownsRankings = !existingIds.has(w.address) || Boolean((previous?.value as { ownsRankings?: boolean } | undefined)?.ownsRankings);
      await db.insert(schema.appMeta).values({ key, value: { source: "Defined", capturedAt: input.capturedAt, ownsRankings, history: "Recent public swap events; incomplete history" }, updatedAt: capturedAt })
        .onConflictDoUpdate({ target: schema.appMeta.key, set: { value: sql`excluded.value`, updatedAt: capturedAt } });
      if (!ownsRankings) continue;
      for (const [period, suffix] of [["24h", "1d"], ["7d", "1w"], ["30d", "30d"]] as const) {
        const pnl = sourceNumber(w[`realizedProfitUsd${suffix}`]);
        const count = sourceNumber(w[`swaps${suffix}`]);
        if (pnl === null || count === null || !Number.isInteger(count) || count < 0) continue;
        const snapshot = { traderId: w.address, period, pnl, trades: count, roi: sourceNumber(w[`realizedProfitPercentage${suffix}`]), winRate: sourceNumber(w[`winRate${suffix}`]), volumeUsd: sourceNumber(w[`volumeUsd${suffix}`]), rank: null, computedAt: capturedAt };
        await db.insert(schema.traderSnapshots).values(snapshot).onConflictDoUpdate({ target: [schema.traderSnapshots.traderId, schema.traderSnapshots.period], set: snapshot });
      }
      if (w.lastTransactionAt) await db.update(schema.traders).set({ lastActiveAt: sql`greatest(${schema.traders.lastActiveAt}, ${new Date(w.lastTransactionAt * 1000).toISOString()}::timestamptz)` }).where(eq(schema.traders.id, w.address));
    }
    await recomputeDerived(db, { providerOwnsRankings: true });
    // Ranks are recomputed across sources, never copied from independent lists.
    await db.execute(sql`update trader_snapshots s set rank = r.rank from (select id, row_number() over (partition by period order by pnl desc, trader_id asc)::int as rank from trader_snapshots) r where s.id = r.id`);
    const added = input.traders.filter((t) => !existingIds.has(t.wallet)).length;
    await db.insert(schema.appMeta).values({ key: "defined:import", value: { capturedAt: input.capturedAt, wallets: input.wallets.length, added, inserted, skipped: input.skipped } }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value: sql`excluded.value`, updatedAt: new Date() } });
    // Preserve real token names after feed stubs were created.
    await upsertTokens(db, input.tokens);
    const total = await db.select({ id: schema.traders.id }).from(schema.traders).where(inArray(schema.traders.id, input.wallets.map((w) => w.address)));
    return { wallets: total.length, added, duplicatesMerged: input.wallets.length - added, tradesInserted: inserted, skippedEvents: input.skipped };
  } finally { await release(); }
}
