import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import type { GuestPublic } from "@/lib/types";

const { guests } = schema;

export const GUEST_COOKIE = "analyst_vid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface Guest extends GuestPublic {
  isNew: boolean;
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(`${env().GUEST_HASH_SALT}:${value}`).digest("hex");
}

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return hashSecret(`ip:${ip}`).slice(0, 32);
}

export function defaultDisplayName(guestId: string): string {
  return `anon-${guestId.replace(/^g_/, "").slice(0, 4).toUpperCase()}`;
}

export function newGuestId(): string {
  return `g_${randomBytes(8).toString("hex")}`;
}

function isProd(): boolean {
  return env().NODE_ENV === "production";
}

/** Reads the current guest without creating one. Safe in Server Components. */
export async function getGuest(): Promise<Guest | null> {
  const store = await cookies();
  const token = store.get(GUEST_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db.select().from(guests).where(eq(guests.tokenHash, hashSecret(token))).limit(1);
  if (!row) return null;
  return { id: row.id, displayName: row.displayName, isNew: false };
}

/** Reads or creates the guest and (re)issues the HttpOnly cookie. Route handlers only. */
export async function getOrCreateGuest(): Promise<Guest> {
  const existing = await getGuest();
  const store = await cookies();
  if (existing) {
    return existing;
  }
  const token = randomBytes(32).toString("hex");
  const id = newGuestId();
  const db = await getDb();
  const [row] = await db
    .insert(guests)
    .values({ id, tokenHash: hashSecret(token), displayName: defaultDisplayName(id) })
    .returning();
  store.set(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return { id: row.id, displayName: row.displayName, isNew: true };
}

const RESERVED = ["analyst", "admin", "moderator", "robinhood", "official", "support", "kolhood", "system"];

export function validateDisplayName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2) return { ok: false, error: "Display name must be at least 2 characters." };
  if (name.length > 24) return { ok: false, error: "Display name must be 24 characters or fewer." };
  if (!/^[A-Za-z0-9_.\- ]+$/.test(name)) return { ok: false, error: "Use letters, numbers, spaces, _ . or - only." };
  const lower = name.toLowerCase();
  if (RESERVED.some((r) => lower === r || lower.startsWith(`${r} `) || lower.startsWith(`${r}_`))) {
    return { ok: false, error: "That name is reserved." };
  }
  if (/^anon-[0-9a-f]{4}$/i.test(name)) return { ok: false, error: "Pick something other than the anonymous format." };
  return { ok: true, name };
}

export async function updateDisplayName(guestId: string, name: string): Promise<void> {
  const db = await getDb();
  await db.update(guests).set({ displayName: name, lastSeenAt: new Date() }).where(eq(guests.id, guestId));
}
