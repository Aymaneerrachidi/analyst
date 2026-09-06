import "server-only";
import { createHash } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isMockProvider } from "@/lib/env";
import { mockUniverse } from "@/lib/providers/mock";
import { hashSecret } from "@/lib/social/guest";

const { guests, posts, comments, ratings, votes } = schema;

/**
 * Seeds discussion, ratings and votes for MOCK mode only, so the community layer looks
 * alive on first run. Every seeded guest is flagged `isSeed`. Never runs against live data.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_NAMES = [
  "gyro", "marketwatch", "quietbull", "feather_fi", "nocturne", "delta_dan", "hoodlum", "sable.eth",
  "tapehead", "kestrelwatch", "greenline", "rooftop", "arbitrage_al", "lowcap", "wickwatcher", "atlas",
  "pinecone", "orbital", "sixfigs", "sundial", "minnow", "dropline", "candlecat", "plainsight",
];

const POST_TEMPLATES = [
  "$SYM accumulation starting to look serious. Top 10 traders are net buyers again.",
  "@HANDLE has been on fire this week. Three green exits in a row.",
  "Watching $SYM closely. KOL net flow flipped positive an hour ago.",
  "$SYM distribution from @HANDLE today. Not panicking, but noting it.",
  "Anyone else see @HANDLE size into $SYM? Biggest buy on the token this week.",
  "$SYM looking extremely strong after today's accumulation.",
  "Ranked traders keep rotating out of $SYM into $SYM2. Interesting.",
  "The $SYM chart says one thing, the KOL flow says another. Trusting the flow.",
  "@HANDLE's win rate is quietly climbing. Underrated account.",
  "$SYM is the most-bought token by tracked wallets in the last 6 hours.",
  "Small position in $SYM. Waiting for more buyers before adding.",
  "Respect to @HANDLE for taking profit on $SYM at the top instead of round-tripping it.",
];

const COMMENT_TEMPLATES = [
  "Agreed. The buyer quality on this one is high.",
  "Net flow is what matters here, not the price.",
  "Been watching this trader since last month. Consistent.",
  "Careful, two of the sellers today are top-10 wallets.",
  "This is the accumulation pattern that worked on $SYM before.",
  "Timing has been excellent lately.",
  "Not convinced yet. Breadth is still thin.",
  "Conviction is there, they added twice today.",
  "Score jumped 12 points since this morning.",
  "Would like to see more than a handful of buyers before I trust it.",
  "Solid take.",
  "Momentum is fading a bit but the holders are strong.",
];

export async function seedSocialIfEmpty(): Promise<void> {
  if (!isMockProvider()) return;
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(posts);
  if (Number(n) > 0) return;

  const rand = rng(7_190_231);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const now = Date.now();
  const sym = () => pick(mockUniverse.tokens).symbol;
  const handle = () => pick(mockUniverse.traders).handle;
  const fill = (tpl: string) =>
    tpl.replace("$SYM2", `$${sym()}`).replace("$SYM", `$${sym()}`).replace("@HANDLE", `@${handle()}`);
  const hash = (s: string) => createHash("sha256").update(s.toLowerCase()).digest("hex").slice(0, 32);

  const seedGuests = SEED_NAMES.map((name, i) => ({
    id: `g_seed${i.toString(16).padStart(12, "0")}`,
    tokenHash: hashSecret(`seed-guest-${i}`),
    displayName: name,
    isSeed: true,
    createdAt: new Date(now - 40 * 86_400_000),
    lastSeenAt: new Date(now - Math.floor(rand() * 86_400_000)),
  }));
  await db.insert(guests).values(seedGuests).onConflictDoNothing();
  const guestIds = seedGuests.map((g) => g.id);

  // Posts
  const postRows = Array.from({ length: 28 }, (_, i) => {
    const body = fill(pick(POST_TEMPLATES));
    const ageMs = Math.floor(Math.pow(rand(), 1.6) * 3 * 86_400_000);
    return {
      id: `p_seed${i.toString(16).padStart(12, "0")}`,
      guestId: pick(guestIds),
      body,
      bodyHash: hash(`${body}${i}`),
      upvotes: Math.floor(rand() * 60),
      downvotes: Math.floor(rand() * 6),
      replyCount: 0,
      createdAt: new Date(now - ageMs),
    };
  });
  await db.insert(posts).values(postRows);

  // Replies to posts + comments on tokens and traders
  const commentRows: (typeof comments.$inferInsert)[] = [];
  let c = 0;
  const addComment = (targetType: "post" | "token" | "trader", targetId: string, parentId: string | null, base: number) => {
    const body = fill(pick(COMMENT_TEMPLATES));
    const id = `c_seed${(c++).toString(16).padStart(12, "0")}`;
    commentRows.push({
      id,
      guestId: pick(guestIds),
      targetType,
      targetId,
      parentId,
      body,
      bodyHash: hash(`${body}${id}`),
      upvotes: Math.floor(rand() * 25),
      downvotes: Math.floor(rand() * 3),
      replyCount: 0,
      createdAt: new Date(base + Math.floor(rand() * 3_600_000 * 6)),
    });
    return id;
  };

  const replyCounts = new Map<string, number>();
  for (const p of postRows) {
    const n = Math.floor(rand() * 5);
    for (let i = 0; i < n; i++) {
      const rootId = addComment("post", p.id, null, p.createdAt.getTime());
      if (rand() < 0.4) addComment("post", p.id, rootId, p.createdAt.getTime() + 600_000);
    }
    replyCounts.set(p.id, n);
  }
  for (const token of mockUniverse.tokens) {
    const n = Math.floor(rand() * 7);
    for (let i = 0; i < n; i++) {
      const rootId = addComment("token", token.address, null, now - Math.floor(rand() * 5 * 86_400_000));
      if (rand() < 0.35) addComment("token", token.address, rootId, now - Math.floor(rand() * 86_400_000));
    }
  }
  for (const trader of mockUniverse.traders) {
    const n = Math.floor(rand() * 5);
    for (let i = 0; i < n; i++) {
      addComment("trader", trader.wallet, null, now - Math.floor(rand() * 6 * 86_400_000));
    }
  }
  for (let i = 0; i < commentRows.length; i += 200) {
    await db.insert(comments).values(commentRows.slice(i, i + 200));
  }
  // Reply counts for posts (root comments only) and parents.
  const parentCounts = new Map<string, number>();
  for (const row of commentRows) if (row.parentId) parentCounts.set(row.parentId, (parentCounts.get(row.parentId) ?? 0) + 1);
  for (const p of postRows) {
    const total = commentRows.filter((r) => r.targetType === "post" && r.targetId === p.id).length;
    if (total > 0) {
      await db.update(posts).set({ replyCount: total }).where(eq(posts.id, p.id));
    }
  }
  for (const [parentId, n] of parentCounts) {
    await db.update(comments).set({ replyCount: n }).where(eq(comments.id, parentId));
  }

  // Ratings: traders and tokens
  const ratingRows: (typeof ratings.$inferInsert)[] = [];
  let r = 0;
  for (const trader of mockUniverse.traders) {
    const base = 5 + rand() * 4;
    const n = 8 + Math.floor(rand() * 40);
    for (let i = 0; i < n && i < guestIds.length; i++) {
      const score = Math.max(1, Math.min(10, Math.round(base + (rand() - 0.5) * 3)));
      ratingRows.push({ id: `r_seed${(r++).toString(16).padStart(12, "0")}`, guestId: guestIds[i], targetType: "trader", targetId: trader.wallet, score });
    }
  }
  for (const token of mockUniverse.tokens) {
    const base = 4 + rand() * 5;
    const n = 4 + Math.floor(rand() * 20);
    for (let i = 0; i < n && i < guestIds.length; i++) {
      const score = Math.max(1, Math.min(10, Math.round(base + (rand() - 0.5) * 3)));
      ratingRows.push({ id: `r_seed${(r++).toString(16).padStart(12, "0")}`, guestId: guestIds[i], targetType: "token", targetId: token.address, score });
    }
  }
  for (let i = 0; i < ratingRows.length; i += 200) {
    await db.insert(ratings).values(ratingRows.slice(i, i + 200)).onConflictDoNothing();
  }

  // A few votes so "mine" states and counters are coherent for seed guests.
  const voteRows: (typeof votes.$inferInsert)[] = [];
  let v = 0;
  for (const p of postRows.slice(0, 12)) {
    for (const gid of guestIds.slice(0, 3)) {
      voteRows.push({ id: `v_seed${(v++).toString(16).padStart(12, "0")}`, guestId: gid, targetType: "post", targetId: p.id, value: 1 });
    }
  }
  await db.insert(votes).values(voteRows).onConflictDoNothing();
}
