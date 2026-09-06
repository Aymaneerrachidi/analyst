import { NextResponse } from "next/server";
import { jsonError, noStore, oneOf, searchParam } from "@/lib/api";
import { getGuest, getOrCreateGuest } from "@/lib/social/guest";
import { deleteOwnPost, getPost, listComments, type SortMode } from "@/lib/social/posts";

const SORTS: SortMode[] = ["top", "new"];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const guest = await getGuest();
  const post = await getPost(id, guest?.id ?? null);
  if (!post) return jsonError(404, "Post not found.");
  const comments = await listComments({
    targetType: "post",
    targetId: id,
    sort: oneOf(searchParam(url, "sort"), SORTS, "top"),
    guestId: guest?.id ?? null,
  });
  return NextResponse.json({ post, comments }, noStore);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guest = await getOrCreateGuest();
  const result = await deleteOwnPost(guest.id, id);
  if (result === "missing") return jsonError(404, "Post not found.");
  if (result === "forbidden") return jsonError(403, "You can only delete your own posts.");
  return NextResponse.json({ ok: true }, noStore);
}
