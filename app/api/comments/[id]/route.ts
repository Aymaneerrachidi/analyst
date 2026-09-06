import { NextResponse } from "next/server";
import { jsonError, noStore } from "@/lib/api";
import { getOrCreateGuest } from "@/lib/social/guest";
import { deleteOwnComment } from "@/lib/social/posts";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guest = await getOrCreateGuest();
  const result = await deleteOwnComment(guest.id, id);
  if (result === "missing") return jsonError(404, "Comment not found.");
  if (result === "forbidden") return jsonError(403, "You can only delete your own comments.");
  return NextResponse.json({ ok: true }, noStore);
}
