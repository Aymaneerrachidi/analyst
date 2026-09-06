import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { analyzePerformance } from "@/lib/performance";
export async function getPerformance(wallet: string) {
  const db = await getDb();
  const t = schema.trades;
  const rows = await db.select({ tokenAddress: t.tokenAddress, symbol: schema.tokens.symbol, side: t.side, amountUsd: t.amountUsd, tokenAmount: t.tokenAmount, timestamp: t.timestamp })
    .from(t).innerJoin(schema.tokens, eq(t.tokenAddress, schema.tokens.address)).where(eq(t.traderId, wallet.toLowerCase())).orderBy(t.timestamp, t.seq);
  return analyzePerformance(rows);
}
