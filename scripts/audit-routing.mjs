import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// Read-only quote audit. Never requests approvals, builds or submits transactions.
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const limit = Number(option("--limit", "16"));
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be between 1 and 100");
const output = option("--out", ".vercel/routing-audit.json");
const app = option("--app", "https://analyst-orpin.vercel.app");
const address = /^0x[0-9a-f]{40}$/i;
const uint = value => typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > 0n;

async function json(url, options = {}) {
  const start = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
    const data = await response.json().catch(() => null);
    return { status: response.status, ms: Date.now() - start, data };
  } catch (error) { return { status: 0, ms: Date.now() - start, error: error.name }; }
}
async function quote(tokenIn, tokenOut, amount) {
  const result = await json("https://www.umbra.finance/api/rh/quote", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokenIn, tokenOut, amount }),
  });
  const d = result.data;
  const quoted = result.status === 200 && uint(d?.netOut) && Array.isArray(d?.legs) && d.legs.length > 0;
  return { status: result.status, ms: result.ms, quoted, amountIn: amount,
    netOut: quoted ? d.netOut : null, feeBps: d?.feeBps ?? null,
    venues: [...new Set((d?.legs ?? []).flatMap(l => l.venues ?? []))],
    verification: d?.verification ?? null,
    error: result.error ?? (!quoted ? String(d?.error ?? d?.message ?? "No usable quote").slice(0, 300) : null) };
}

async function zeroExPrice(sellToken, buyToken, sellAmount) {
  const params = new URLSearchParams({ chainId: "4663", sellToken, buyToken, sellAmount });
  const result = await json(`https://api.0x.org/swap/allowance-holder/price?${params}`, {
    headers: { "0x-version": "v2", "0x-api-key": process.env.ZERO_EX_API_KEY },
  });
  const d = result.data;
  const quoted = result.status === 200 && d?.liquidityAvailable === true && uint(d?.buyAmount);
  return { status: result.status, ms: result.ms, quoted, amountIn: sellAmount,
    buyAmount: quoted ? d.buyAmount : null, fees: d?.fees ?? null,
    venues: [...new Set((d?.route?.fills ?? []).map(f => f.source))],
    error: result.error ?? (!quoted ? String(d?.name ?? d?.message ?? "No indicative price").slice(0, 300) : null) };
}

const feed = await json(`${app}/api/trades?limit=200`);
if (!Array.isArray(feed.data?.trades) || feed.data?.freshness?.isMock !== false) throw new Error("Expected a live, non-mock trade feed");
const candidates = new Map();
for (const t of feed.data.trades) {
  if (address.test(t.token?.address)) candidates.set(t.token.address.toLowerCase(), { address: t.token.address.toLowerCase(), symbol: t.token.symbol });
}
const tokens = [...candidates.values()].slice(0, limit);
const sources = await json("https://api.0x.org/sources?chainId=4663", {
  headers: { "0x-version": "v2", ...(process.env.ZERO_EX_API_KEY ? { "0x-api-key": process.env.ZERO_EX_API_KEY } : {}) },
});
const report = { capturedAt: new Date().toISOString(), chainId: 4663,
  methodology: "Recent unique tokens from ANALYST feed; quote buys with 0.01 ETH and reverse sells of quoted net output. Quote availability only; no wallet simulation or transaction submission. Sample is not the chain's entire token universe.",
  zeroEx: { status: sources.status, sources: sources.data?.sources ?? null,
    note: sources.status === 401 ? "Our own API key is required; executable coverage remains unverified." : "Source discovery only; per-token quote testing still required." },
  results: [],
};
for (let i = 0; i < tokens.length; i += 2) {
  const rows = await Promise.all(tokens.slice(i, i + 2).map(async token => {
    const buy = await quote("ETH", token.address, "10000000000000000");
    const sell = buy.quoted ? await quote(token.address, "ETH", buy.netOut) : null;
    const result = { ...token, provider: "umbra", buy, sell };
    if (process.env.ZERO_EX_API_KEY && sources.status === 200) {
      const native = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      const buy = await zeroExPrice(native, token.address, "10000000000000000");
      const sell = buy.quoted ? await zeroExPrice(token.address, native, buy.buyAmount) : null;
      result.zeroEx = { buy, sell, note: "Indicative prices, not wallet-specific executable quotes." };
    }
    console.log(JSON.stringify({ symbol: token.symbol, buy: buy.quoted, sell: sell?.quoted ?? null, feeBps: buy.feeBps, venues: buy.venues }));
    return result;
  }));
  report.results.push(...rows);
}
report.summary = { tokens: tokens.length, buyQuotes: report.results.filter(r => r.buy.quoted).length,
  bothDirections: report.results.filter(r => r.buy.quoted && r.sell?.quoted).length,
  observedVenues: [...new Set(report.results.flatMap(r => [...r.buy.venues, ...(r.sell?.venues ?? [])]))] };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output, ...report.summary }));
