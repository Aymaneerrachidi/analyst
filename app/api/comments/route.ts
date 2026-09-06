import { NextResponse } from "next/server";
import { z } from "zod";
import { intParam, jsonError, noStore, oneOf, parseJson, searchParam } from "@/lib/api";
import { getGuest } from "@/lib/social/guest";
import { createComment, getComment, isDuplicateComment, listComments, type CommentTarget, type SortMode } from "@/lib/social/posts";
import { guardContent, guardWrite } from "@/lib/social/write-guard";
import { MAX_BODY_LENGTH } from "@/lib/social/moderation";
import { postExists, tokenExists, traderExists } from "@/lib/services/exists";
import { ensureBootstrapped } from "@/lib/services/sync";
import { seedSocialIfEmpty } from "@/lib/db/seed-social";

const TARGETS: CommentTarget[] = ["token", "trader", "post"];
const SORTS: SortMode[] = ["top", "new"];

async function targetExists(type: CommentTarget, id: string): Promise<boolean> {
  if (type === "token") return tokenExists(id);
  if (type === "trader") return traderExists(id);
  return postExists(id);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const targetType = searchParam(url, "targetType");
  const targetId = searchParam(url, "targetId");
  if (!targetType || !targetId || !TARGETS.includes(targetType as CommentTarget)) {
    return jsonError(400, "targetType and targetId are required.");
  }
  await ensureBootstrapped().catch(() => undefined);
  await seedSocialIfEmpty().catch(() => undefined);
  const guest = await getGuest();
  const comments = await listComments({
    targetType: targetType as CommentTarget,
    targetId: targetType === "post" ? targetId : targetId.toLowerCase(),
    sort: oneOf(searchParam(url, "sort"), SORTS, "top"),
    limit: intParam(url, "limit", 50, 1, 200),
    guestId: guest?.id ?? null,
  });
  return NextResponse.json({ comments }, noStore);
}

const createSchema = z.object({
  targetType: z.enum(["token", "trader", "post"]),
  targetId: z.string().min(1).max(128),
  parentId: z.string().min(1).max(64).nullable().optional(),
  body: z.string().max(MAX_BODY_LENGTH * 2),
  website: z.string().optional(), // honeypot
});

export async function POST(req: Request) {
  const parsed = await parseJson(req, createSchema);
  if (!parsed.ok) return parsed.response;
  const { targetType } = parsed.data;
  const targetId = targetType === "post" ? parsed.data.targetId : parsed.data.targetId.toLowerCase();
  if (!(await targetExists(targetType, targetId))) return jsonError(404, "That page no longer exists.");

  let parentId: string | null = null;
  if (parsed.data.parentId) {
    const parent = await getComment(parsed.data.parentId);
    if (!parent || parent.deletedAt || parent.targetType !== targetType || parent.targetId !== targetId) {
      return jsonError(404, "The comment you are replying to is gone.");
    }
    // Threads are one level deep: replying to a reply attaches to its root.
    parentId = parent.parentId ?? parent.id;
  }

  const guard = await guardWrite(req, "comment");
  if (!guard.ok) return guard.response;
  const content = await guardContent(guard.ctx, "comment", parsed.data);
  if (!content.ok) return content.response;
  if (await isDuplicateComment(guard.ctx.guest.id, content.bodyHash)) return jsonError(409, "You already said that.");

  const comment = await createComment({
    guestId: guard.ctx.guest.id,
    targetType,
    targetId,
    parentId,
    body: content.body,
    bodyHash: content.bodyHash,
    ipHash: guard.ctx.ipHash,
  });
  return NextResponse.json({ comment }, { status: 201, ...noStore });
}
