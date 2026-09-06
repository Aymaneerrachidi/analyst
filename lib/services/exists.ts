import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export async function tokenExists(address: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select({ a: schema.tokens.address }).from(schema.tokens).where(eq(schema.tokens.address, address.toLowerCase())).limit(1);
  return Boolean(row);
}

export async function traderExists(id: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select({ id: schema.traders.id }).from(schema.traders).where(eq(schema.traders.id, id.toLowerCase())).limit(1);
  return Boolean(row);
}

export async function postExists(id: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select({ id: schema.posts.id, deletedAt: schema.posts.deletedAt }).from(schema.posts).where(eq(schema.posts.id, id)).limit(1);
  return Boolean(row && !row.deletedAt);
}
