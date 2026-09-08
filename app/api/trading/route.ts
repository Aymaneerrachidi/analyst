import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { clientIp, noStore } from "@/lib/api";
import { addressSchema, tradeInputSchema } from "@/lib/trading/shared";
import { getAssets, getQuote, TradingError } from "@/lib/trading/server";

export const runtime = "nodejs";
export const maxDuration = 60;
// Instance-level abuse guard. Configure a Vercel firewall rule for a global quota.
const buckets = new Map<string, { until: number; hits: number }>();
function guard(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) throw new TradingError("Cross-origin trading requests are not allowed.", 403);
  const now = Date.now();
  for (const [key, b] of buckets) if (b.until < now) buckets.delete(key);
  const key = createHash("sha256").update(clientIp(req) ?? "unknown").digest("hex");
  const b = buckets.get(key) ?? { until: now + 60_000, hits: 0 };
  if (++b.hits > 40 || buckets.size > 10_000) throw new TradingError("Too many quote requests. Try again in a minute.", 429);
  buckets.set(key, b);
}
function failure(error: unknown) {
  const status = error instanceof TradingError ? error.status : 502;
  return NextResponse.json({ error: error instanceof TradingError ? error.message : "Could not verify this trade. Refresh and try again." }, { status, ...noStore });
}
export async function GET(req: Request) {
  try {
    guard(req);
    const p = new URL(req.url).searchParams;
    const token = addressSchema.safeParse(p.get("token"));
    const account = p.has("account") ? addressSchema.safeParse(p.get("account")) : undefined;
    if (!token.success || (account && !account.success)) throw new TradingError("Invalid token or wallet address.", 400);
    return NextResponse.json(await getAssets(token.data, account?.data), noStore);
  } catch (e) { return failure(e); }
}
export async function POST(req: Request) {
  try {
    guard(req);
    if (!req.headers.get("content-type")?.includes("application/json")) throw new TradingError("Expected JSON.", 415);
    const reader = req.body?.getReader();
    if (!reader) throw new TradingError("Missing trade request.", 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2048) { await reader.cancel(); throw new TradingError("Trade request is too large.", 413); } chunks.push(value); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new TradingError("Invalid JSON.", 400); }
    const input = tradeInputSchema.safeParse(body);
    if (!input.success) throw new TradingError(input.error.issues[0]?.message ?? "Invalid trade.", 400);
    return NextResponse.json(await getQuote(input.data), noStore);
  } catch (e) { return failure(e); }
}
