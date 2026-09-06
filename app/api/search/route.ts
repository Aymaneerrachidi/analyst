import { NextResponse } from "next/server";
import { noStore, searchParam } from "@/lib/api";
import { search } from "@/lib/services/intelligence";
import { ensureBootstrapped } from "@/lib/services/sync";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (searchParam(url, "q") ?? "").slice(0, 64);
  await ensureBootstrapped().catch(() => undefined);
  const results = q.trim().length === 0 ? { tokens: [], traders: [] } : await search(q, 6);
  return NextResponse.json(results, noStore);
}
