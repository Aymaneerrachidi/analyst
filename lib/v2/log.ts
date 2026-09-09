export function logEvent(scope: "INDEXER" | "RPC" | "DEXSCREENER" | "BLOCKSCOUT" | "BASE44" | "SIGNALS" | "ALERTS" | "TRADING", event: string, data: Record<string, string | number | boolean | null> = {}) {
  // Call sites pass typed counters/status codes, never arbitrary errors or provider URLs.
  console.log(JSON.stringify({ time: new Date().toISOString(), scope, event, ...data }));
}
