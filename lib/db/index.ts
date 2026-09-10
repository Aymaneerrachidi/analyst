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
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const postgres = (await import("postgres")).default;
  const client = postgres(url, { prepare: false, max: process.env.ANALYST_WORKER === "1" ? 3 : 2, idle_timeout: 20, connect_timeout: 15 });
  const db = drizzle(client, { schema });
  if (!process.env.VERCEL && process.env.ANALYST_WORKER !== '1') await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
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
    if (holder.driver && holder.schemaVersion !== 4) {
      holder.schemaReady ??= (async () => {
        if (holder.driver === "pglite") {
          const { migrate } = await import("drizzle-orm/pglite/migrator");
          await migrate(holder.db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
        } else if (!process.env.VERCEL && process.env.ANALYST_WORKER !== '1') {
          const { migrate } = await import("drizzle-orm/postgres-js/migrator");
          await migrate(holder.db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
        }
        holder.schemaVersion = 4;
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
        holder.schemaVersion = 4;
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
