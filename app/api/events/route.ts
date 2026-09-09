import { NextResponse } from "next/server";
import { v2Config } from "@/lib/v2/config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
/** Authenticated server proxy: upstream RPC and worker credentials never enter the browser. */
export async function GET(req: Request) {
  const config = v2Config();
  if (!config.INDEXER_URL || !config.INDEXER_SECRET) return NextResponse.json({ error: "Shared live delivery is not configured." }, { status: 503 });
  try {
    const response = await fetch(new URL('/events', config.INDEXER_URL), { headers: { authorization: `Bearer ${config.INDEXER_SECRET}` }, signal: AbortSignal.any([req.signal, AbortSignal.timeout(280_000)]), cache: "no-store" });
    if (!response.ok || !response.body) return NextResponse.json({ error: "Live delivery is reconnecting." }, { status: 503 });
    return new Response(response.body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
  } catch { return NextResponse.json({ error: "Live delivery is reconnecting." }, { status: 503 }); }
}
