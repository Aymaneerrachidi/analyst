import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ensureBootstrapped } from "@/lib/services/sync";
import { getPost, listComments } from "@/lib/social/posts";
import { getGuest } from "@/lib/social/guest";
import { PostCard } from "@/components/social/post-card";
import { DiscussionThread } from "@/components/social/discussion-thread";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const post = await getPost(id, null).catch(() => null);
  return { title: post ? `${post.author.displayName}: ${post.body.slice(0, 60)}` : "Post" };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureBootstrapped().catch(() => undefined);
  const guest = await getGuest();
  const post = await getPost(id, guest?.id ?? null);
  if (!post) notFound();
  const comments = await listComments({ targetType: "post", targetId: post.id, sort: "top", guestId: guest?.id ?? null });
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/social" className="inline-flex items-center gap-1.5 text-sm text-secondary transition-colors hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to Social
      </Link>
      <PostCard post={post} standalone />
      <DiscussionThread targetType="post" targetId={post.id} initialComments={comments} title="Replies" placeholder="Write a reply..." />
    </div>
  );
}
