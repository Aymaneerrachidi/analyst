import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getProvider } from "@/lib/providers";
import { fetchTokenCandles } from "@/lib/providers/geckoterminal";
import { fetchLaunchpadChart } from "@/lib/providers/launchpad";
import { marketDataEnabled } from "@/lib/providers/market-data";
import type { FlowWindow, TokenChartData, TokenCandle } from "@/lib/types";
import { WINDOW_MS } from "./sync";

export async function getTokenChart(address: string, window: FlowWindow): Promise<TokenChartData> {
  const db = await getDb();
  const span = WINDOW_MS[window];
  const now = Date.now();
  const start = now - span;
  const rows = await db.select({ t: schema.trades.timestamp, side: schema.trades.side, usd: schema.trades.amountUsd, price: schema.trades.price })
    .from(schema.trades)
    .where(and(eq(schema.trades.tokenAddress, address.toLowerCase()), gt(schema.trades.timestamp, new Date(start))))
    .orderBy(schema.trades.timestamp);
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
    return { window, candles, activity, source: "mock", marketUrl: null };
  }
  if (!marketDataEnabled()) return { window, candles: [], activity, source: "unavailable", marketUrl: null };
  try {
    const result = await fetchTokenCandles(address, window);
    if (result.candles.length) return { window, candles: result.candles, activity, source: "geckoterminal", marketUrl: result.marketUrl, fdv: result.token?.fdv, liquidityUsd: result.token?.liquidityUsd };
  } catch (error) {
    console.error("[token-chart]", error instanceof Error ? error.message : "Price source failed");
  }
  const launchpad = await fetchLaunchpadChart(address, window);
  if (launchpad?.candles.length) return { window, candles: launchpad.candles, priceUnit: launchpad.unit, activity, source: "pons", marketUrl: `https://www.ponsfamily.com/launchpad/${address}` };
  return { window, candles: [], activity, source: "unavailable", marketUrl: null, error: "Neither market source currently has price history for this period." };
}
