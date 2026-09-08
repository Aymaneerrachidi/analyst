import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, noStore, parseJson } from "@/lib/api";
import { getGuest, updateDisplayName, validateDisplayName } from "@/lib/social/guest";
import { guardWrite } from "@/lib/social/write-guard";

export async function GET() {
  const guest = await getGuest();
  return NextResponse.json({ guest: guest ? { id: guest.id, displayName: guest.displayName } : null }, noStore);
}

const schema = z.object({ displayName: z.string().max(64) });

export async function POST(req: Request) {
  const parsed = await parseJson(req, schema);
  if (!parsed.ok) return parsed.response;
  const valid = validateDisplayName(parsed.data.displayName);
  if (!valid.ok) return jsonError(422, valid.error);
  const guard = await guardWrite(req, "identity");
  if (!guard.ok) return guard.response;
  const { guest } = guard.ctx;
  await updateDisplayName(guest.id, valid.name);
  return NextResponse.json({ guest: { id: guest.id, displayName: valid.name } }, noStore);
}
