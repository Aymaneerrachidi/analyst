import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, noStore, parseJson } from "@/lib/api";
import { castVote } from "@/lib/social/posts";
import { guardWrite } from "@/lib/social/write-guard";

const schema = z.object({
  targetType: z.enum(["post", "comment"]),
  targetId: z.string().min(1).max(64),
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});

export async function POST(req: Request) {
  const parsed = await parseJson(req, schema);
  if (!parsed.ok) return parsed.response;
  const guard = await guardWrite(req, "vote");
  if (!guard.ok) return guard.response;
  const result = await castVote(guard.ctx.guest.id, parsed.data.targetType, parsed.data.targetId, parsed.data.value);
  if (!result) return jsonError(404, "Nothing to vote on.");
  return NextResponse.json(result, noStore);
}
