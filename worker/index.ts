import { createServer, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createPublicClient, webSocket } from "viem";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../lib/db";
import { ChainIndexer } from "../lib/indexer/engine";
import { CURSOR, readCursor } from "../lib/indexer/store";
import { v2Config } from "../lib/v2/config";
import { logEvent } from "../lib/v2/log";
import { robinhood } from "../lib/trading/shared";

const config = v2Config();
const missing = [!process.env.DATABASE_URL && "DATABASE_URL", !config.ALCHEMY_RPC_URL && "ALCHEMY_RPC_URL", !config.ALCHEMY_WS_URL && "ALCHEMY_WS_URL", config.INDEXER_START_BLOCK == null && "INDEXER_START_BLOCK", (config.INDEXER_SECRET?.length ?? 0) < 32 && "INDEXER_SECRET", !(config.PONS_FACTORY_ADDRESS || config.UNISWAP_FACTORY_ADDRESS || config.pools.length) && "PONS_FACTORY_ADDRESS or UNISWAP_FACTORY_ADDRESS or VERIFIED_POOL_ADDRESSES"].filter(Boolean);
if (process.argv.includes("--check")) {
  console.log(JSON.stringify({ ready: missing.length === 0, missing }));
  process.exit(missing.length ? 2 : 0);
}
if (missing.length) { console.error(`Worker configuration required: ${missing.join(', ')}`); process.exit(2); }

const clients = new Set<ServerResponse>();
const engine = new ChainIndexer();
let stopping = false, failures = 0, wsStatus = "connecting", lastAnalytics = 0, lastWsBlock = 0;
let work: Promise<void> | undefined;
let analytics: Promise<void> | undefined;
const broadcast = (event: string, data: unknown) => {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of clients) { if (response.writableLength > 512_000) { response.end(); clients.delete(response); } else response.write(message); }
};
const authorized = (header?: string) => { const supplied = Buffer.from(header ?? ""), expected = Buffer.from(`Bearer ${config.INDEXER_SECRET}`); return supplied.length === expected.length && timingSafeEqual(supplied, expected); };
const server = createServer(async (req, res) => {
  if (req.url === "/health") {
    try { const cursor = await readCursor(); res.writeHead(cursor && Date.now() - cursor.updatedAt.getTime() < 120_000 ? 200 : 503, { "content-type": "application/json" }); res.end(JSON.stringify({ service: "analyst-indexer", status: cursor?.status ?? "starting", wsStatus, lastIndexedBlock: cursor?.blockNumber ?? null, updatedAt: cursor?.updatedAt ?? null })); }
    catch { res.writeHead(503); res.end('{"status":"unavailable"}'); }
    return;
  }
  if (req.url !== "/events" || !authorized(req.headers.authorization)) { res.writeHead(401); res.end(); return; }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  res.write(`event: status\ndata: ${JSON.stringify({ status: "live", upstream: wsStatus })}\n\n`);
  clients.add(res); req.on("close", () => clients.delete(res));
});

async function cycle() {
  if (stopping || work) return;
  work = (async () => {
    try {
      const result = await engine.tick(); failures = 0;
      if (result.blocks) broadcast("indexed", { ...result, at: new Date().toISOString() });
      // Registered background pipeline runs independently from browser requests.
      if (!analytics && Date.now() - lastAnalytics >= 60_000) {
        lastAnalytics = Date.now();
        analytics = import("../lib/v2/pipeline").then(m => m.runPipeline()).then(() => undefined).catch(() => logEvent("SIGNALS", "pipeline_failed")).finally(() => { analytics = undefined; });
      }
    } catch { failures++; logEvent("INDEXER", "cycle_failed", { failures }); }
  })().finally(() => { work = undefined; });
  await work;
}

await engine.initialize();
server.listen(config.INDEXER_PORT, "0.0.0.0", () => logEvent("INDEXER", "started", { port: config.INDEXER_PORT }));
const socketClient = createPublicClient({ chain: robinhood, transport: webSocket(config.ALCHEMY_WS_URL!, { reconnect: { attempts: Number.POSITIVE_INFINITY, delay: 1000 }, timeout: 15_000 }) });
const unwatch = socketClient.watchBlockNumber({ onBlockNumber: () => { lastWsBlock = Date.now(); wsStatus = "live"; void cycle(); }, onError: () => { wsStatus = "reconnecting"; logEvent("RPC", "ws_disconnected"); }, emitOnBegin: true });
const heartbeat = setInterval(() => { if (Date.now() - lastWsBlock > 30_000) wsStatus = "reconnecting"; broadcast("heartbeat", { at: new Date().toISOString(), upstream: wsStatus }); void getDb().then(db => db.update(schema.chainCursors).set({ wsStatus }).where(eq(schema.chainCursors.name, CURSOR))).catch(() => logEvent("INDEXER", "heartbeat_failed")); }, 15_000);
async function poll() { while (!stopping) { await cycle(); await new Promise(resolve => setTimeout(resolve, Math.min(60_000, config.INDEXER_POLL_MS * 2 ** Math.min(failures, 4)))); } }
void poll();
async function stop() { if (stopping) return; stopping = true; unwatch(); clearInterval(heartbeat); for (const client of clients) client.end(); server.close(); await work; await analytics; await engine.release(); logEvent("INDEXER", "stopped"); process.exit(0); }
process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
