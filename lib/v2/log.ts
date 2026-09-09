export function logEvent(scope: "INDEXER" | "RPC" | "DEXSCREENER" | "BLOCKSCOUT" | "BASE44" | "SIGNALS" | "ALERTS" | "TRADING", event: string, data: Record<string, string | number | boolean | null> = {}) {
  // Call sites pass typed counters/status codes, never arbitrary errors or provider URLs.
  console.log(JSON.stringify({ time: new Date().toISOString(), scope, event, ...data }));
}

export function errorCode(error: unknown): string {
  const codes: string[] = [];
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth++) {
    const e = current as { name?: unknown; code?: unknown; status?: unknown; cause?: unknown };
    if (typeof e.name === 'string' && /^[A-Za-z]{1,48}$/.test(e.name)) codes.push(e.name);
    if (typeof e.code === 'number' || typeof e.code === 'string' && /^(?:[0-9]{5}|[0-9]{2}[A-Z][0-9]{2}|ECONNRESET|ETIMEDOUT)$/.test(e.code)) codes.push(String(e.code));
    if (typeof e.status === 'number') codes.push(`HTTP${e.status}`);
    current = e.cause;
  }
  return codes.join(':').slice(0,240) || 'UnknownError';
}
