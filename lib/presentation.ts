/** Remove display-only cashtag prefixes; contract addresses remain the identity. */
export function cleanSymbol(symbol: string) { return symbol.trim().replace(/^\$+/, "") || "Unknown"; }
export function plural(count: number, noun: string) { return `${count} ${noun}${count === 1 ? "" : "s"}`; }
export const ASSET_CATEGORIES = ["all", "memes", "stocks", "stablecoins", "other", "new"] as const;
export type AssetCategory = typeof ASSET_CATEGORIES[number];
// Descriptive metadata classification, never an assertion of issuer authenticity.
export const STABLE_SYMBOLS = ["USDG", "USDC", "USDT", "DAI", "USDE", "USDS", "PYUSD", "FDUSD"];
export const STOCK_SYMBOLS = ["MSFT", "AAPL", "NVDA", "SPY", "QQQ", "DJT", "GOOGL", "GOOG", "TSLA", "AMZN", "META", "BABA", "GME", "SPCX", "HOODON", "COIN", "AMD", "NFLX"];
export const MEME_SYMBOLS = ["MEME", "CHAD", "PEPE", "DOGE", "SHIB", "BONK", "FLOKI", "WIF", "TCAT"];
export function assetCategory(symbol: string): Exclude<AssetCategory, "all" | "new"> {
  const value = cleanSymbol(symbol).toUpperCase();
  return STABLE_SYMBOLS.includes(value) ? "stablecoins" : STOCK_SYMBOLS.includes(value) ? "stocks" : MEME_SYMBOLS.includes(value) ? "memes" : "other";
}
