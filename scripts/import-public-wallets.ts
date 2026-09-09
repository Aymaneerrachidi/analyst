import fs from "node:fs";
import { config } from "dotenv";
import { z } from "zod";

// Public identity snapshots only. Performance figures from different providers
// are not interchangeable, and a label is not proof of wallet ownership.
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase());
const identity = z.object({ wallet: address, name: z.string().min(1), avatar: z.string().url().optional(), twitterUrl: z.string().url().optional() });
const snapshot = z.object({ source: z.enum(["Defined", "Stalkchain", "Kolosseum"]), url: z.string().url(), capturedAt: z.string().datetime(), chainId: z.literal(4663), rows: z.array(identity) });

async function main() {
  const [file, envFile = ".env.local", mode = "preview"] = process.argv.slice(2);
  if (!file || !["preview", "apply"].includes(mode)) throw new Error("Usage: import-public-wallets.ts snapshot.json [env-file] [preview|apply]");
  const input = snapshot.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  config({ path: envFile, quiet: true });
  const { getDb, schema } = await import("../lib/db");
  const { eq, sql } = await import("drizzle-orm");
  const db = await getDb();
  const [policy] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, "tracking:source-policy"));
  const allowed = (policy?.value as { sources?: string[] } | undefined)?.sources;
  if (allowed && !allowed.includes(input.source.toLowerCase())) throw new Error("Source excluded by tracking policy");
  const rows = [...new Map(input.rows.map((r) => [r.wallet, r])).values()];
  const existing = new Set((await db.select({ id: schema.traders.id }).from(schema.traders)).map((r) => r.id.toLowerCase()));
  const report = { source: input.source, capturedAt: input.capturedAt, wallets: rows.length, added: rows.filter((r) => !existing.has(r.wallet)).length, existing: rows.filter((r) => existing.has(r.wallet)).length, mode };
  if (mode === "apply" && rows.length) await db.transaction(async (tx) => {
    for (let offset = 0; offset < rows.length; offset += 200) {
      const batch = rows.slice(offset, offset + 200);
      await tx.insert(schema.traders).values(batch.map((row) => ({ id: row.wallet, wallet: row.wallet, name: row.name, handle: row.wallet, avatar: row.avatar, twitterUrl: row.twitterUrl })))
        .onConflictDoUpdate({ target: schema.traders.id, set: { avatar: sql`coalesce(${schema.traders.avatar}, excluded.avatar)`, twitterUrl: sql`coalesce(${schema.traders.twitterUrl}, excluded.twitter_url)` } });
      await tx.insert(schema.wallets).values(batch.map((row) => ({ address: row.wallet, chainId: 4663, publicLabel: row.name, displayName: row.name, kolVerified: false }))).onConflictDoNothing();
      await tx.insert(schema.appMeta).values(batch.map((row) => ({
        key: `wallet-source:${input.source.toLowerCase()}:${row.wallet}`,
        value: { source: input.source, url: input.url, capturedAt: input.capturedAt, label: row.name, verification: "public provider label; ownership unverified", history: "identity import only" },
        updatedAt: new Date(input.capturedAt),
      }))).onConflictDoUpdate({ target: schema.appMeta.key, set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` }, setWhere: sql`${schema.appMeta.updatedAt} <= excluded.updated_at` });
    }
  });
  console.log(JSON.stringify(report));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof z.ZodError ? "Invalid public wallet snapshot" : error instanceof Error ? error.name : "Import failed"); process.exit(1); });
