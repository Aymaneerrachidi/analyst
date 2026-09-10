import { researchConfigured } from '@/lib/services/token-research';
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { readCursor } from "@/lib/indexer/store";
import { noStore } from "@/lib/api";
import { v2Config } from "@/lib/v2/config";
import { executionEnabled } from '@/lib/trading/direct-server';

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    const config = v2Config();
    const cursor = await readCursor();
    const [pipeline] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'v2:pipeline')).limit(1);
    const ageMs = cursor ? Math.max(0, Date.now() - cursor.updatedAt.getTime()) : null;
    const configured = Boolean(config.INDEXER_URL);
    const healthy = !configured || Boolean(cursor && ageMs != null && ageMs < 120_000 && ["live", "indexing", "catching_up"].includes(cursor.status));
    return NextResponse.json({ status: healthy ? "ok" : "degraded", database: "reachable", chainId: 4663,
      indexer: { status: cursor?.status ?? "not configured", lastIndexedBlock: cursor?.blockNumber ?? null, coverageStartBlock: cursor?.startBlock ?? null, websocket: cursor?.wsStatus ?? "not configured", ageMs },
      pipeline: pipeline ? { updatedAt: pipeline.updatedAt, ageMs: Date.now() - pipeline.updatedAt.getTime(), ...(pipeline.value as { stages?: unknown }) } : { status: 'not started' },
      features: { research: researchConfigured(), directTrading: executionEnabled(), sharedStream: configured && Boolean(config.INDEXER_SECRET) },
      launchReady: healthy && configured && Boolean(config.INDEXER_SECRET) && cursor?.status === 'live' && Boolean(pipeline && Date.now() - pipeline.updatedAt.getTime() < 300000),
    }, { ...noStore, status: healthy ? 200 : 503 });
  } catch { return NextResponse.json({ status: "unavailable" }, { ...noStore, status: 503 }); }
}
