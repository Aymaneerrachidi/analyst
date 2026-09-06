import type { TokenCandle } from "./types";

/** Historical executions only: never substitute a current quote or invent OHLC. */
export function executionPriceSamples(rows: { t: Date; price: number | null; usd: number | null; tokenAmount?: number | null }[]): TokenCandle[] {
  return rows.flatMap((row) => {
    if (row.usd == null || !Number.isFinite(row.usd) || row.usd < 0) return [];
    const price = row.price ?? (row.usd != null && row.tokenAmount != null && row.tokenAmount > 0 ? row.usd / row.tokenAmount : null);
    if (price == null || !Number.isFinite(price) || price <= 0 || !Number.isFinite(row.t.getTime())) return [];
    return [{ t: row.t.getTime(), close: price, volume: row.usd }];
  }).slice(-1000);
}
