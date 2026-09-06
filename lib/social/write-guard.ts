import "server-only";
import type { NextResponse } from "next/server";
import { clientIp, jsonError, rateLimited } from "@/lib/api";
import { getOrCreateGuest, hashIp, type Guest } from "./guest";
import { checkCooldown, checkGuestLimit, checkIpLimit, type LimitedAction } from "./ratelimit";
import { moderateContent } from "./moderation";

export interface GuardedWrite {
  guest: Guest;
  ipHash: string | null;
}

/** Identity + rate limiting shared by every guest write. */
export async function guardWrite(req: Request, action: LimitedAction): Promise<{ ok: true; ctx: GuardedWrite } | { ok: false; response: NextResponse }> {
  const ipHash = hashIp(clientIp(req));
  const ip = checkIpLimit(ipHash, action);
  if (!ip.ok) return { ok: false, response: rateLimited(ip.retryAfterSec) };
  const guest = await getOrCreateGuest();
  const limit = await checkGuestLimit(guest.id, action);
  if (!limit.ok) {
    return { ok: false, response: rateLimited(limit.retryAfterSec, `Limit reached (${limit.limit} per window). Try again later.`) };
  }
  return { ok: true, ctx: { guest, ipHash } };
}

/** Honeypot + cooldown + content policy for posts and comments. */
export async function guardContent(
  ctx: GuardedWrite,
  kind: "post" | "comment",
  input: { body: string; website?: string },
): Promise<{ ok: true; body: string; bodyHash: string } | { ok: false; response: NextResponse }> {
  if (input.website && input.website.trim().length > 0) {
    // Bots fill the hidden field; humans never see it. Pretend success without storing anything.
    return { ok: false, response: jsonError(202, "Accepted") };
  }
  const cooldown = await checkCooldown(ctx.guest.id, kind);
  if (!cooldown.ok) return { ok: false, response: rateLimited(cooldown.retryAfterSec, `Give it ${cooldown.retryAfterSec}s before posting again.`) };
  const moderated = moderateContent(input.body);
  if (!moderated.ok) return { ok: false, response: jsonError(422, moderated.error) };
  return { ok: true, body: moderated.body, bodyHash: moderated.bodyHash };
}
