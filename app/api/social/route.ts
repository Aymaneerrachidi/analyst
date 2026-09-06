import { NextResponse } from "next/server";
import { z } from "zod";
import { intParam, jsonError, noStore, oneOf, parseJson, searchParam } from "@/lib/api";
import { getGuest } from "@/lib/social/guest";
import { createPost, isDuplicatePost, listPosts, type SortMode } from "@/lib/social/posts";
import { guardContent, guardWrite } from "@/lib/social/write-guard";
import { MAX_BODY_LENGTH } from "@/lib/social/moderation";
import { ensureBootstrapped } from "@/lib/services/sync";
import { seedSocialIfEmpty } from "@/lib/db/seed-social";

const SORTS: SortMode[] = ["top", "new"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  await ensureBootstrapped().catch(() => undefined);
  await seedSocialIfEmpty().catch(() => undefined);
  const guest = await getGuest();
  const posts = await listPosts({
    guestId: guest?.id ?? null,
    sort: oneOf(searchParam(url, "sort"), SORTS, "new"),
    limit: intParam(url, "limit", 30, 1, 100),
    before: searchParam(url, "before"),
  });
  return NextResponse.json({ posts }, noStore);
}

const createSchema = z.object({
  body: z.string().max(MAX_BODY_LENGTH * 2),
  website: z.string().optional(), // honeypot
});

export async function POST(req: Request) {
  const parsed = await parseJson(req, createSchema);
  if (!parsed.ok) return parsed.response;
  const guard = await guardWrite(req, "post");
  if (!guard.ok) return guard.response;
  const content = await guardContent(guard.ctx, "post", parsed.data);
  if (!content.ok) return content.response;
  if (await isDuplicatePost(guard.ctx.guest.id, content.bodyHash)) {
    return jsonError(409, "You already posted that.");
  }
  const post = await createPost({ guestId: guard.ctx.guest.id, body: content.body, bodyHash: content.bodyHash, ipHash: guard.ctx.ipHash });
  return NextResponse.json({ post }, { status: 201, ...noStore });
}
