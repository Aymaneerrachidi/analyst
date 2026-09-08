import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { SocialComment, SocialPost } from "@/lib/types";
import { buildRefs } from "./refs";
import { isMockProvider } from "@/lib/env";

const { posts, comments, votes, reports, guests } = schema;

export type CommentTarget = "token" | "trader" | "post";
export type VoteTarget = "post" | "comment";
export type SortMode = "top" | "new";

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

async function myVotes(guestId: string | null, targetType: VoteTarget, ids: string[]): Promise<Map<string, 1 | -1>> {
  const out = new Map<string, 1 | -1>();
  if (!guestId || ids.length === 0) return out;
  const db = await getDb();
  const rows = await db
    .select({ targetId: votes.targetId, value: votes.value })
    .from(votes)
    .where(and(eq(votes.guestId, guestId), eq(votes.targetType, targetType), inArray(votes.targetId, ids)));
  for (const r of rows) out.set(r.targetId, r.value > 0 ? 1 : -1);
  return out;
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export interface ListPostsOptions {
  sort?: SortMode;
  limit?: number;
  before?: string; // ISO cursor on createdAt
  guestId: string | null;
}

export async function listPosts(opts: ListPostsOptions): Promise<SocialPost[]> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const where: SQL[] = [isNull(posts.deletedAt)];
  if (!isMockProvider()) where.push(eq(guests.isSeed, false));
  if (opts.before) where.push(sql`${posts.createdAt} < ${new Date(opts.before).toISOString()}::timestamptz`);
  const order =
    opts.sort === "top"
      ? [desc(sql`(${posts.upvotes} - ${posts.downvotes}) * 1.0 / power(extract(epoch from now() - ${posts.createdAt}) / 3600 + 2, 1.3)`), desc(posts.createdAt)]
      : [desc(posts.createdAt)];
  const rows = await db
    .select({ post: posts, author: { id: guests.id, displayName: guests.displayName } })
    .from(posts)
    .innerJoin(guests, eq(posts.guestId, guests.id))
    .where(and(...where))
    .orderBy(...order)
    .limit(limit);
  return hydratePosts(rows, opts.guestId);
}

export async function getPost(id: string, guestId: string | null): Promise<SocialPost | null> {
  const db = await getDb();
  const rows = await db
    .select({ post: posts, author: { id: guests.id, displayName: guests.displayName } })
    .from(posts)
    .innerJoin(guests, eq(posts.guestId, guests.id))
    .where(and(eq(posts.id, id), isNull(posts.deletedAt), isMockProvider() ? undefined : eq(guests.isSeed, false)))
    .limit(1);
  const [hydrated] = await hydratePosts(rows, guestId);
  return hydrated ?? null;
}

async function hydratePosts(
  rows: { post: typeof posts.$inferSelect; author: { id: string; displayName: string } }[],
  guestId: string | null,
): Promise<SocialPost[]> {
  const [refs, mine] = await Promise.all([
    buildRefs(rows.map((r) => r.post.body)),
    myVotes(
      guestId,
      "post",
      rows.map((r) => r.post.id),
    ),
  ]);
  const systemIds = rows.filter(r => r.author.id === "g_analyst_system").map(r => `system:${r.post.id}`);
  if (systemIds.length) {
    const db = await getDb();
    const metadata = await db.select().from(schema.appMeta).where(inArray(schema.appMeta.key, systemIds));
    const byKey = new Map(metadata.map(m => [m.key, m.value as { address: string; symbol: string }]));
    rows.forEach((r, i) => {
      const meta = r.author.id === "g_analyst_system" ? byKey.get(`system:${r.post.id}`) : undefined;
      if (meta) refs[i] = [{ kind: "token", label: `$${meta.symbol}`, href: `/token/${meta.address}` }];
    });
  }
  return rows.map(({ post, author }, i) => ({
    id: post.id,
    author,
    body: post.body,
    refs: refs[i],
    upvotes: post.upvotes,
    downvotes: post.downvotes,
    score: post.upvotes - post.downvotes,
    replyCount: post.replyCount,
    createdAt: post.createdAt.toISOString(),
    myVote: mine.get(post.id) ?? 0,
    mine: guestId === post.guestId,
  }));
}

export async function isDuplicatePost(guestId: string, bodyHash: string): Promise<boolean> {
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [row] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.guestId, guestId), eq(posts.bodyHash, bodyHash), gt(posts.createdAt, since)))
    .limit(1);
  return Boolean(row);
}

export async function createPost(input: { guestId: string; body: string; bodyHash: string; ipHash: string | null }): Promise<SocialPost> {
  const db = await getDb();
  const id = newId("p");
  await db.insert(posts).values({ id, guestId: input.guestId, body: input.body, bodyHash: input.bodyHash, ipHash: input.ipHash });
  const created = await getPost(id, input.guestId);
  if (!created) throw new Error("Post vanished after insert");
  return created;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export interface ListCommentsOptions {
  targetType: CommentTarget;
  targetId: string;
  sort?: SortMode;
  limit?: number;
  guestId: string | null;
}

export async function listComments(opts: ListCommentsOptions): Promise<SocialComment[]> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const order =
    opts.sort === "top"
      ? [desc(sql`${comments.upvotes} - ${comments.downvotes}`), desc(comments.createdAt)]
      : [desc(comments.createdAt)];

  const roots = await db
    .select({ comment: comments, author: { id: guests.id, displayName: guests.displayName } })
    .from(comments)
    .innerJoin(guests, eq(comments.guestId, guests.id))
    .where(and(eq(comments.targetType, opts.targetType), eq(comments.targetId, opts.targetId), isNull(comments.parentId), isNull(comments.deletedAt), isMockProvider() ? undefined : eq(guests.isSeed, false)))
    .orderBy(...order)
    .limit(limit);

  const rootIds = roots.map((r) => r.comment.id);
  const replies =
    rootIds.length === 0
      ? []
      : await db
          .select({ comment: comments, author: { id: guests.id, displayName: guests.displayName } })
          .from(comments)
          .innerJoin(guests, eq(comments.guestId, guests.id))
          .where(and(inArray(comments.parentId, rootIds), isNull(comments.deletedAt), isMockProvider() ? undefined : eq(guests.isSeed, false)))
          .orderBy(comments.createdAt);

  const all = [...roots, ...replies];
  const [refs, mine] = await Promise.all([
    buildRefs(all.map((r) => r.comment.body)),
    myVotes(
      opts.guestId,
      "comment",
      all.map((r) => r.comment.id),
    ),
  ]);
  const hydrated = all.map(({ comment, author }, i): SocialComment => ({
    id: comment.id,
    author,
    targetType: comment.targetType as CommentTarget,
    targetId: comment.targetId,
    parentId: comment.parentId,
    body: comment.body,
    refs: refs[i],
    upvotes: comment.upvotes,
    downvotes: comment.downvotes,
    score: comment.upvotes - comment.downvotes,
    replyCount: comment.replyCount,
    createdAt: comment.createdAt.toISOString(),
    myVote: mine.get(comment.id) ?? 0,
    mine: opts.guestId === comment.guestId,
    replies: [],
  }));
  const byId = new Map(hydrated.map((c) => [c.id, c]));
  const out: SocialComment[] = [];
  for (const c of hydrated) {
    if (c.parentId) byId.get(c.parentId)?.replies?.push(c);
    else out.push(c);
  }
  return out;
}

export async function getComment(id: string): Promise<typeof comments.$inferSelect | null> {
  const db = await getDb();
  const [row] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
  return row ?? null;
}

export async function isDuplicateComment(guestId: string, bodyHash: string): Promise<boolean> {
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [row] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.guestId, guestId), eq(comments.bodyHash, bodyHash), gt(comments.createdAt, since)))
    .limit(1);
  return Boolean(row);
}

export async function createComment(input: {
  guestId: string;
  targetType: CommentTarget;
  targetId: string;
  parentId: string | null;
  body: string;
  bodyHash: string;
  ipHash: string | null;
}): Promise<SocialComment> {
  const db = await getDb();
  const id = newId("c");
  await db.insert(comments).values({
    id,
    guestId: input.guestId,
    targetType: input.targetType,
    targetId: input.targetId,
    parentId: input.parentId,
    body: input.body,
    bodyHash: input.bodyHash,
    ipHash: input.ipHash,
  });
  if (input.parentId) {
    await db.update(comments).set({ replyCount: sql`${comments.replyCount} + 1` }).where(eq(comments.id, input.parentId));
  }
  if (input.targetType === "post") {
    await db.update(posts).set({ replyCount: sql`${posts.replyCount} + 1` }).where(eq(posts.id, input.targetId));
  }
  const [refs] = await buildRefs([input.body]);
  const [author] = await db.select({ id: guests.id, displayName: guests.displayName }).from(guests).where(eq(guests.id, input.guestId));
  return {
    id,
    author,
    targetType: input.targetType,
    targetId: input.targetId,
    parentId: input.parentId,
    body: input.body,
    refs,
    upvotes: 0,
    downvotes: 0,
    score: 0,
    replyCount: 0,
    createdAt: new Date().toISOString(),
    myVote: 0,
    mine: true,
    replies: [],
  };
}

export async function deleteOwnComment(guestId: string, id: string): Promise<"deleted" | "forbidden" | "missing"> {
  const db = await getDb();
  const row = await getComment(id);
  if (!row || row.deletedAt) return "missing";
  if (row.guestId !== guestId) return "forbidden";
  await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, id));
  if (row.parentId) {
    await db.update(comments).set({ replyCount: sql`greatest(${comments.replyCount} - 1, 0)` }).where(eq(comments.id, row.parentId));
  }
  if (row.targetType === "post") {
    await db.update(posts).set({ replyCount: sql`greatest(${posts.replyCount} - 1, 0)` }).where(eq(posts.id, row.targetId));
  }
  return "deleted";
}

export async function deleteOwnPost(guestId: string, id: string): Promise<"deleted" | "forbidden" | "missing"> {
  const db = await getDb();
  const [row] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!row || row.deletedAt) return "missing";
  if (row.guestId !== guestId) return "forbidden";
  await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, id));
  return "deleted";
}

// ---------------------------------------------------------------------------
// Votes + reports
// ---------------------------------------------------------------------------

export async function castVote(
  guestId: string,
  targetType: VoteTarget,
  targetId: string,
  value: 1 | -1 | 0,
): Promise<{ upvotes: number; downvotes: number; myVote: 1 | -1 | 0 } | null> {
  const db = await getDb();
  const table = targetType === "post" ? posts : comments;
  return db.transaction(async (tx) => {
    // Lock the target before reading the previous vote. This also serializes
    // first-time votes, where there is no vote row to lock yet.
    const [target] = await tx
      .select({ id: table.id, deletedAt: table.deletedAt, upvotes: table.upvotes, downvotes: table.downvotes })
      .from(table)
      .where(eq(table.id, targetId))
      .limit(1)
      .for("update");
    if (!target || target.deletedAt) return null;

    const [existing] = await tx
      .select({ id: votes.id, value: votes.value })
      .from(votes)
      .where(and(eq(votes.guestId, guestId), eq(votes.targetType, targetType), eq(votes.targetId, targetId)))
      .limit(1);
    const prev = existing ? (existing.value > 0 ? 1 : -1) : 0;
    if (prev === value) return { upvotes: target.upvotes, downvotes: target.downvotes, myVote: value };

    const upDelta = (value === 1 ? 1 : 0) - (prev === 1 ? 1 : 0);
    const downDelta = (value === -1 ? 1 : 0) - (prev === -1 ? 1 : 0);
    if (value === 0 && existing) {
      await tx.delete(votes).where(eq(votes.id, existing.id));
    } else if (existing) {
      await tx.update(votes).set({ value, updatedAt: new Date() }).where(eq(votes.id, existing.id));
    } else if (value !== 0) {
      await tx.insert(votes).values({ id: newId("v"), guestId, targetType, targetId, value });
    }
    const [row] = await tx
      .update(table)
      .set({
        upvotes: sql`greatest(${table.upvotes} + ${upDelta}, 0)`,
        downvotes: sql`greatest(${table.downvotes} + ${downDelta}, 0)`,
      })
      .where(eq(table.id, targetId))
      .returning({ upvotes: table.upvotes, downvotes: table.downvotes });
    return { upvotes: row.upvotes, downvotes: row.downvotes, myVote: value };
  });
}

export async function fileReport(input: { guestId: string; targetType: VoteTarget; targetId: string; reason: string; details?: string }): Promise<"ok" | "missing"> {
  const db = await getDb();
  const table = input.targetType === "post" ? posts : comments;
  const [target] = await db.select({ id: table.id }).from(table).where(eq(table.id, input.targetId)).limit(1);
  if (!target) return "missing";
  await db
    .insert(reports)
    .values({ id: newId("rp"), guestId: input.guestId, targetType: input.targetType, targetId: input.targetId, reason: input.reason, details: input.details ?? null })
    .onConflictDoNothing();
  return "ok";
}

export async function countComments(targetType: CommentTarget, targetId: string): Promise<number> {
  const db = await getDb();
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(eq(comments.targetType, targetType), eq(comments.targetId, targetId), isNull(comments.deletedAt)));
  return Number(r?.n ?? 0);
}
