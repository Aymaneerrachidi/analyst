import "server-only";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { analyzePerformance } from "@/lib/performance";
import { walletHistory } from '@/lib/intelligence/service';
export async function getPerformance(wallet: string) {
  const db = await getDb();
  const history = await walletHistory(wallet.toLowerCase(), Date.now(), false);
  const addresses = [...new Set(history.map(t => t.token))];
  const tokens = addresses.length ? await db.select({ address: schema.tokens.address, symbol: schema.tokens.symbol }).from(schema.tokens).where(inArray(schema.tokens.address, addresses)) : [];
  const symbols = new Map(tokens.map(t => [t.address, t.symbol]));
  const rows = history.sort((a,b) => a.timestamp - b.timestamp || a.order - b.order).map(t => ({ tokenAddress: t.token, symbol: symbols.get(t.token) ?? 'Unknown', side: t.side,
    amountUsd: t.usd, tokenAmount: ['payer differs from recipient', 'unverified swap attribution', 'transaction initiator'].includes(t.attribution ?? '') ? null : t.quantity, timestamp: new Date(t.timestamp) }));
  return analyzePerformance(rows);
}
