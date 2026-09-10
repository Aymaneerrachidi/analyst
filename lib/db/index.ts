import "server-only";
import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { env } from "@/lib/env";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type Holder = {
  db?: Db;
  ready?: Promise<Db>;
  driver?: "pglite" | "postgres";
  schemaVersion?: number;
  schemaReady?: Promise<void>;
};

const globalHolder = globalThis as unknown as { __analystDb?: Holder };
const holder: Holder = globalHolder.__analystDb ?? (globalHolder.__analystDb = {});

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

async function createPostgres(url: string): Promise<Db> {
  if (process.env.VERCEL) {
    const { Pool } = await import("pg");
    const { attachDatabasePool } = await import("@vercel/functions");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const connectionUrl = new URL(url);
    const supabase = connectionUrl.hostname.endsWith(".pooler.supabase.com");
    const ssl = supabase ? { ca: (await import("./supabase-ca")).SUPABASE_CA, rejectUnauthorized: true } : undefined;
    if (supabase) connectionUrl.searchParams.delete("sslmode");
    // Vercel must drain idle sockets before suspending an instance. A plain
    // persistent postgres.js pool can reuse a dead socket and hang the page.
    const pool = new Pool({
      connectionString: connectionUrl.href,
      ...(ssl ? { ssl } : {}),
      max: 2,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 5_000,
      query_timeout: 15_000,
      keepAlive: true,
      allowExitOnIdle: true,
    });
    pool.on("error", () => console.error("[database] Idle connection closed; next query will reconnect."));
    attachDatabasePool(pool);
    holder.driver = "postgres";
    return drizzle(pool, { schema }) as unknown as Db;
  }
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const postgres = (await import("postgres")).default;
  const client = postgres(url, { prepare: false, max: process.env.ANALYST_WORKER === "1" ? 3 : 2, idle_timeout: 20, connect_timeout: 15 });
  const db = drizzle(client, { schema });
  if (!process.env.VERCEL) await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  holder.driver = "postgres";
  return db as unknown as Db;
}

async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // Runtime database files are mutable storage, never deployment build assets.
  const dataDir = path.resolve(/* turbopackIgnore: true */ process.cwd(), env().PGLITE_DATA_DIR || ".data/pglite");
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  holder.driver = "pglite";
  // Let local development restarts flush the embedded database before exit.
  const close = () => { void client.close().catch((error) => console.error("[database:close]", error instanceof Error ? error.message : error)); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  process.once("beforeExit", close);
  return db as unknown as Db;
}

/** Returns the migrated database singleton (Postgres when DATABASE_URL is set, embedded PGlite otherwise). */
export function getDb(): Promise<Db> {
  if (holder.db) {
    // Development hot reload preserves the connection, but must still apply new migrations.
    if (holder.driver && holder.schemaVersion !== 2) {
      holder.schemaReady ??= (async () => {
        if (holder.driver === "pglite") {
          const { migrate } = await import("drizzle-orm/pglite/migrator");
          await migrate(holder.db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
        } else {
          const { migrate } = await import("drizzle-orm/postgres-js/migrator");
          await migrate(holder.db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
        }
        holder.schemaVersion = 2;
      })().finally(() => { holder.schemaReady = undefined; });
      return holder.schemaReady.then(() => holder.db!);
    }
    return Promise.resolve(holder.db);
  }
  if (!holder.ready) {
    const url = env().DATABASE_URL;
    holder.ready = (url ? createPostgres(url) : createPglite())
      .then((db) => {
        holder.db = db;
        holder.schemaVersion = 2;
        return db;
      })
      .catch((err) => {
        holder.ready = undefined;
        throw err;
      });
  }
  return holder.ready;
}

export function dbDriver(): "pglite" | "postgres" | "unknown" {
  return holder.driver ?? "unknown";
}

export { schema };
