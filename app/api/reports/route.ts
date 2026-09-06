import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, noStore, parseJson } from "@/lib/api";
import { fileReport } from "@/lib/social/posts";
import { guardWrite } from "@/lib/social/write-guard";

const schema = z.object({
  targetType: z.enum(["post", "comment"]),
  targetId: z.string().min(1).max(64),
  reason: z.enum(["spam", "scam", "harassment", "misinformation", "other"]),
  details: z.string().max(300).optional(),
});

export async function POST(req: Request) {
  const parsed = await parseJson(req, schema);
  if (!parsed.ok) return parsed.response;
  const guard = await guardWrite(req, "vote");
  if (!guard.ok) return guard.response;
  const result = await fileReport({ guestId: guard.ctx.guest.id, ...parsed.data });
  if (result === "missing") return jsonError(404, "Nothing to report.");
  return NextResponse.json({ ok: true }, noStore);
}
