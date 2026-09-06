import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError, noStore, oneOf, searchParam } from "@/lib/api";
import { env } from "@/lib/env";
import { runSync } from "@/lib/services/sync";
import { seedSocialIfEmpty } from "@/lib/db/seed-social";

function authorized(req: Request): boolean {
  const secret = env().INTERNAL_SYNC_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Data ingestion trigger for schedulers (cron, Vercel Cron, GitHub Actions). Never exposed to browsers. */
export async function POST(req: Request) {
  if (!authorized(req)) return jsonError(401, "Unauthorized.");
  const url = new URL(req.url);
  const kind = oneOf(searchParam(url, "kind"), ["full", "trades"] as const, "trades");
  try {
    const result = await runSync(kind);
    await seedSocialIfEmpty();
    return NextResponse.json({ ok: true, result }, noStore);
  } catch (err) {
    return jsonError(502, err instanceof Error ? err.message : "Sync failed.");
  }
}
