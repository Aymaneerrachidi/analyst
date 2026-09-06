import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/** Keep development caches on disk and deployed caches in shared PostgreSQL. */
export async function readCache<T>(namespace: string, key: string): Promise<T | null> {
  if (process.env.NODE_TEST_CONTEXT) return null;
  try {
    if (process.env.VERCEL) {
      const db = await getDb();
      const [row] = await db.select({ value: schema.appMeta.value }).from(schema.appMeta)
        .where(eq(schema.appMeta.key, `cache:${namespace}:${key}`)).limit(1);
      return (row?.value as T) ?? null;
    }
    return JSON.parse(await readFile(path.join(/* turbopackIgnore: true */ process.cwd(), ".data", namespace, `${key}.json`), "utf8")) as T;
  } catch { return null; }
}

export async function writeCache(namespace: string, key: string, value: unknown): Promise<void> {
  if (process.env.NODE_TEST_CONTEXT) return;
  try {
    if (process.env.VERCEL) {
      const db = await getDb();
      await db.insert(schema.appMeta).values({ key: `cache:${namespace}:${key}`, value })
        .onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt: new Date() } });
    } else {
      const root = path.join(/* turbopackIgnore: true */ process.cwd(), ".data", namespace);
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, `${key}.json`), JSON.stringify(value));
    }
  } catch (error) {
    // A cache failure must not discard a successfully fetched source response.
    console.error("[cache:write]", error instanceof Error ? error.message : "Cache unavailable");
  }
}
