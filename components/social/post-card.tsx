"use client";

import { Flag, Link2, MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { apiSend } from "@/lib/client/fetcher";
import { toast } from "@/lib/client/toast";
import type { SocialPost } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TraderAvatar } from "@/components/common/avatar";
import { TimeAgo } from "@/components/common/time-ago";
import { RichBody } from "./rich-body";
import { VoteButtons } from "./vote-buttons";
import { ReportDialog } from "./report-dialog";

export function PostCard({ post, onDeleted, standalone }: { post: SocialPost; onDeleted?: (id: string) => void; standalone?: boolean }) {
  const [reporting, setReporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pending = post.id.startsWith("temp_");
  const href = `/social/${post.id}`;

  const share = async () => {
    const url = `${window.location.origin}${href}`;
    try {
      if (navigator.share) {
        await navigator.share({ url, text: post.body.slice(0, 80) });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      // cancelled
    }
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await apiSend(`/api/social/${post.id}`, "DELETE");
      onDeleted?.(post.id);
      toast("Post deleted");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete", "negative");
      setDeleting(false);
    }
  };

  return (
    <article className={cn("card p-4 md:p-5", pending && "opacity-60")} id={post.id}>
      <div className="flex items-start gap-3">
        <TraderAvatar name={post.author.displayName} id={post.author.id} size="md" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span className="font-medium text-primary">{post.author.displayName}</span>
            {post.mine && <span className="rounded border border-border px-1 text-[10px] text-muted">you</span>}
            <TimeAgo value={post.createdAt} className="text-muted" />
          </div>
          <div className="mt-1.5">
            <RichBody body={post.body} refs={post.refs} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <VoteButtons targetType="post" targetId={post.id} upvotes={post.upvotes} downvotes={post.downvotes} myVote={post.myVote} size="sm" />
            {standalone ? (
              <span className="inline-flex h-7 items-center gap-1.5 px-2 text-xs text-muted">
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="tnum">{post.replyCount}</span> {post.replyCount === 1 ? "reply" : "replies"}
              </span>
            ) : (
              <Link href={href} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-primary" aria-disabled={pending}>
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="tnum">{post.replyCount}</span> {post.replyCount === 1 ? "reply" : "replies"}
              </Link>
            )}
            <button type="button" onClick={share} disabled={pending} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-primary">
              <Link2 className="h-3.5 w-3.5" />
              Share
            </button>
            {post.mine && !pending ? (
              <button type="button" onClick={remove} disabled={deleting} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-negative">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            ) : (
              !pending && (
                <button type="button" onClick={() => setReporting(true)} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-primary">
                  <Flag className="h-3.5 w-3.5" />
                  Report
                </button>
              )
            )}
          </div>
        </div>
      </div>
      <ReportDialog open={reporting} onOpenChange={setReporting} targetType="post" targetId={post.id} />
    </article>
  );
}
