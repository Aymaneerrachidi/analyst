import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, noStore, parseJson, searchParam } from "@/lib/api";
import { getGuest } from "@/lib/social/guest";
import { getRatingSummary, upsertRating } from "@/lib/social/ratings";
import { guardWrite } from "@/lib/social/write-guard";
import { tokenExists, traderExists } from "@/lib/services/exists";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const targetType = searchParam(url, "targetType");
  const targetId = searchParam(url, "targetId")?.toLowerCase();
  if ((targetType !== "token" && targetType !== "trader") || !targetId) return jsonError(400, "targetType and targetId are required.");
  const guest = await getGuest();
  const summary = await getRatingSummary(targetType, targetId, guest?.id ?? null);
  return NextResponse.json(summary, noStore);
}

const schema = z.object({
  targetType: z.enum(["token", "trader"]),
  targetId: z.string().min(1).max(128),
  score: z.number().int().min(1).max(10),
});

export async function POST(req: Request) {
  const parsed = await parseJson(req, schema);
  if (!parsed.ok) return parsed.response;
  const targetId = parsed.data.targetId.toLowerCase();
  const exists = parsed.data.targetType === "token" ? await tokenExists(targetId) : await traderExists(targetId);
  if (!exists) return jsonError(404, "Nothing to rate.");
  const guard = await guardWrite(req, "rating");
  if (!guard.ok) return guard.response;
  await upsertRating(guard.ctx.guest.id, parsed.data.targetType, targetId, parsed.data.score);
  const summary = await getRatingSummary(parsed.data.targetType, targetId, guard.ctx.guest.id);
  return NextResponse.json(summary, noStore);
}
