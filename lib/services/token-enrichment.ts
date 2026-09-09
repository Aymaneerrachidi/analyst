import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { fetchDexQuotes } from '@/lib/providers/market-data';

/** Two requests per minute: recent activity plus a persistent sweep of all known tokens. */
export async function enrichTrackedTokens() {
  const db = await getDb();
  const key = 'markets:dexscreener';
  const [active, inventory, checkpoint] = await Promise.all([
    db.select({ address: schema.tokens.address }).from(schema.tokens).orderBy(desc(schema.tokens.lastActivityAt)).limit(30),
    db.select({ address: schema.tokens.address }).from(schema.tokens).orderBy(schema.tokens.address),
    db.select().from(schema.appMeta).where(eq(schema.appMeta.key, key)).limit(1),
  ]);
  const offset = Math.max(0, Number((checkpoint[0]?.value as { offset?: number })?.offset) || 0) % Math.max(1, inventory.length);
  const sweep = [...inventory.slice(offset), ...inventory.slice(0, offset)].slice(0, 30);
  const addresses = [...new Set([...active, ...sweep].map(row => row.address))];
  let matched = 0, images = 0;
  for (let start = 0; start < addresses.length; start += 30) {
    const quotes = await fetchDexQuotes(addresses.slice(start, start + 30));
    for (const [address, quote] of quotes) {
      const timestamp = new Date(quote.observedAt!);
      await db.update(schema.tokens).set({
        name: quote.name || undefined, symbol: quote.symbol || undefined, image: quote.image || undefined,
        price: quote.price ?? undefined, marketCap: quote.marketCap ?? undefined, fdv: quote.fdv ?? undefined,
        volume24h: quote.volume24h ?? undefined, priceChange24h: quote.priceChange24h ?? undefined, updatedAt: timestamp,
      }).where(eq(schema.tokens.address, address));
      if (quote.price != null) await db.insert(schema.marketObservations).values({
        tokenAddress: address, timestamp, source: 'Dexscreener', priceUsd: quote.price,
        marketCap: quote.marketCap, fdv: quote.fdv, liquidityUsd: quote.liquidityUsd || null,
        volume5m: quote.volume5m, volume1h: quote.volume1h, volume6h: quote.volume6h, volume24h: quote.volume24h,
        priceChange5m: quote.priceChange5m, priceChange1h: quote.priceChange1h,
        buys5m: quote.buys5m, sells5m: quote.sells5m,
        completeness: { prices: 'observed quote', history: 'not backfilled' },
      }).onConflictDoNothing();
      matched++; if (quote.image) images++;
    }
  }
  // Advance only after successful reads and writes. No-match tokens still advance the sweep.
  const status = { at: new Date().toISOString(), offset: offset + sweep.length, total: inventory.length, checked: addresses.length, matched, images };
  await db.insert(schema.appMeta).values({ key, value: status }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value: status, updatedAt: new Date() } });
  return status;
}
