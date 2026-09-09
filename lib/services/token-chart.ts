import { listTrades } from "./intelligence";
import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getProvider } from "@/lib/providers";
import { fetchTokenCandles } from "@/lib/providers/geckoterminal";
import { fetchLaunchpadChart } from "@/lib/providers/launchpad";
import { marketDataEnabled } from "@/lib/providers/market-data";
import type { FlowWindow, TokenChartData, TokenCandle } from "@/lib/types";
import { WINDOW_MS } from "./sync";
import { executionPriceSamples } from "@/lib/chart-executions";
import { preserveChartHistory } from "@/lib/chart-series";
import { readCache, writeCache } from "@/lib/providers/persistent-cache";

export async function getTokenChart(address: string, window: FlowWindow): Promise<TokenChartData> {
  if (process.env.INDEXER_URL && process.env.ANALYST_WORKER !== '1') {
    const db = await getDb();
    await db.insert(schema.appMeta).values({ key: `demand:chart:${address.toLowerCase()}:${window}`, value: { address: address.toLowerCase(), window } }).onConflictDoNothing();
    const cached = await readCache<TokenChartData & { retrievedAt?: string }>('chart-history', `${address.toLowerCase()}-${window}`);
    if (cached) {
      const markers = (await listTrades({ tokenAddress: address, limit: 200 })).filter(t => Date.parse(t.timestamp) >= Date.now() - WINDOW_MS[window]);
      if (cached.retrievedAt && Date.now() - Date.parse(cached.retrievedAt) < 120000) return { ...cached, markers };
      return preserveChartHistory({ ...cached, markers, candles: [] }, cached, Date.now());
    }
  }
  const result = await loadTokenChart(address, window);
  if (getProvider().isMock) return result;
  const key = `${address.toLowerCase()}-${window}`;
  if (result.candles.length) {
    await writeCache("chart-history", key, { ...result, retrievedAt: new Date().toISOString() });
    return result;
  }
  // Providers can return an empty HTTP 200 during outages. Preserve real history
  // across serverless instances instead of replacing a working chart with a blank.
  return preserveChartHistory(result, await readCache<TokenChartData>("chart-history", key), Date.now());
}

async function loadTokenChart(address: string, window: FlowWindow): Promise<TokenChartData> {
  const db = await getDb();
  const span = WINDOW_MS[window];
  const now = Date.now();
  const start = now - span;
  const imported = await db.select({ hash: schema.trades.txHash, wallet: schema.trades.traderId, t: schema.trades.timestamp, side: schema.trades.side, usd: schema.trades.amountUsd, price: schema.trades.price, tokenAmount: schema.trades.tokenAmount })
    .from(schema.trades)
    .where(and(eq(schema.trades.tokenAddress, address.toLowerCase()), gt(schema.trades.timestamp, new Date(start))))
    .orderBy(schema.trades.timestamp, schema.trades.seq);
  const indexed = await db.select().from(schema.chainSwaps).where(and(eq(schema.chainSwaps.tokenAddress, address.toLowerCase()), gt(schema.chainSwaps.timestamp, new Date(start)))).orderBy(schema.chainSwaps.timestamp, schema.chainSwaps.logIndex);
  const identities = new Set(indexed.map(t => `${t.txHash.toLowerCase()}:${t.walletAddress}:${t.side}`));
  const rows = [...imported.filter(t => !t.hash || !identities.has(`${t.hash.toLowerCase()}:${t.wallet}:${t.side}`)), ...indexed.map(t => ({ t: t.timestamp, side: t.side, usd: t.usdValue, price: t.executionPrice, tokenAmount: Number(t.amountToken) }))].sort((a, b) => a.t.getTime() - b.t.getTime());
  const markers = (await listTrades({ tokenAddress: address, limit: 200 })).filter(t => Date.parse(t.timestamp) >= start);
  const activity = rows.length ? Array.from({ length: 48 }, (_, i) => ({ t: start + (i + 1) * span / 48, buyUsd: 0, sellUsd: 0, buys: 0, sells: 0 })) : [];
  for (const row of rows) {
    const index = Math.min(47, Math.max(0, Math.floor((row.t.getTime() - start) / span * 48)));
    const point = activity[index];
    if (row.side === "BUY") { point.buyUsd += row.usd ?? 0; point.buys += 1; }
    else { point.sellUsd += row.usd ?? 0; point.sells += 1; }
  }
  if (getProvider().isMock) {
    // Use prices already present in synthetic trades; don't invent chart samples.
    const candles: TokenCandle[] = rows.flatMap((row) => row.price === null ? [] : [{ t: row.t.getTime(), open: row.price, high: row.price, low: row.price, close: row.price, volume: row.usd ?? 0 }]);
    return { window, markers, candles, activity, source: "mock", marketUrl: null };
  }
  const executions = executionPriceSamples(rows);
  const fallback: TokenChartData = executions.length
    ? { window, markers, candles: executions, activity, source: "executions", priceUnit: "USD", marketUrl: null }
    : { window, markers, candles: [], activity, source: "unavailable", marketUrl: null, error: "No market history or priced executions are available for this period." };
  if (!marketDataEnabled() || process.env.INDEXER_URL && process.env.ANALYST_WORKER !== "1") return fallback;
  try {
    const result = await fetchTokenCandles(address, window);
    if (result.candles.length) return { window, markers, candles: result.candles, activity, source: "geckoterminal", marketUrl: result.marketUrl, fdv: result.token?.fdv, liquidityUsd: result.token?.liquidityUsd };
  } catch (error) {
    console.error("[token-chart]", error instanceof Error ? error.message : "Price source failed");
  }
  const launchpad = await fetchLaunchpadChart(address, window);
  if (launchpad?.candles.length) return { window, markers, candles: launchpad.candles, priceUnit: launchpad.unit, activity, source: "pons", marketUrl: `https://www.ponsfamily.com/launchpad/${address}` };
  return fallback;
}
