"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { apiGet, apiSend } from "@/lib/client/fetcher";
import { toast } from "@/lib/client/toast";
import type { SocialComment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonLines } from "@/components/ui/skeleton";
import { TimeAgo } from "@/components/common/time-ago";
import { TraderAvatar } from "@/components/common/avatar";
import { CommentComposer } from "./comment-composer";
import { RichBody } from "./rich-body";
import { VoteButtons } from "./vote-buttons";
import { ReportDialog } from "./report-dialog";

type Sort = "top" | "new";

interface Props {
  targetType: "token" | "trader" | "post";
  targetId: string;
  initialComments?: SocialComment[];
  title?: string;
  placeholder?: string;
  hideHeader?: boolean;
}

export function DiscussionThread({ targetType, targetId, initialComments, title = "Community", placeholder, hideHeader }: Props) {
  const qc = useQueryClient();
  const [sort, setSort] = useState<Sort>("top");
  const key = ["comments", targetType, targetId, sort];
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => apiGet<{ comments: SocialComment[] }>(`/api/comments?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}&sort=${sort}`),
    initialData: initialComments && sort === "top" ? { comments: initialComments } : undefined,
    staleTime: 10_000,
  });
  const comments = data?.comments ?? [];

  const mutate = useCallback(
    (fn: (list: SocialComment[]) => SocialComment[]) => {
      qc.setQueryData<{ comments: SocialComment[] }>(key, (prev) => ({ comments: fn(prev?.comments ?? []) }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, targetType, targetId, sort],
  );

  const insert = (c: SocialComment) =>
    mutate((list) => {
      if (c.parentId) {
        return list.map((root) => (root.id === c.parentId ? { ...root, replies: [...(root.replies ?? []), c], replyCount: root.replyCount + 1 } : root));
      }
      return [c, ...list];
    });
  const replace = (tempId: string, real: SocialComment) =>
    mutate((list) =>
      list.map((root) => {
        if (root.id === tempId) return { ...real, replies: root.replies };
        return { ...root, replies: (root.replies ?? []).map((r) => (r.id === tempId ? real : r)) };
      }),
    );
  const remove = (id: string) =>
    mutate((list) =>
      list
        .filter((root) => root.id !== id)
        .map((root) => {
          const before = root.replies?.length ?? 0;
          const replies = (root.replies ?? []).filter((r) => r.id !== id);
          return { ...root, replies, replyCount: root.replyCount - (before - replies.length) };
        }),
    );

  const total = comments.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);

  return (
    <section aria-label={title}>
      {!hideHeader && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight md:text-xl">{title}</h2>
            <p className="mt-0.5 text-sm text-secondary">{total > 0 ? `${total} ${total === 1 ? "comment" : "comments"} · What do you think?` : "What do you think? No account needed."}</p>
          </div>
          <FilterTabs
            size="sm"
            value={sort}
            onChange={setSort}
            options={[
              { value: "top", label: "Top" },
              { value: "new", label: "New" },
            ]}
            ariaLabel="Sort comments"
          />
        </div>
      )}

      <CommentComposer targetType={targetType} targetId={targetId} placeholder={placeholder} onOptimistic={insert} onCreated={(real, tempId) => replace(tempId, real)} onFailed={remove} />

      <div className="mt-4 space-y-3">
        {isLoading && <SkeletonLines count={3} />}
        {isError && <ErrorState title="Comments didn’t load." action={<button className="text-sm text-neon" onClick={() => refetch()}>Retry</button>} />}
        {!isLoading && !isError && comments.length === 0 && (
          <EmptyState title="No comments yet." description="Be the first to say something useful." />
        )}
        {comments.map((c) => (
          <CommentCard key={c.id} comment={c} targetType={targetType} targetId={targetId} onReply={insert} onReplyCreated={replace} onReplyFailed={remove} onDeleted={remove} />
        ))}
      </div>
    </section>
  );
}

export function CommentCard({
  comment,
  targetType,
  targetId,
  onReply,
  onReplyCreated,
  onReplyFailed,
  onDeleted,
  isReply,
}: {
  comment: SocialComment;
  targetType: Props["targetType"];
  targetId: string;
  onReply: (c: SocialComment) => void;
  onReplyCreated: (tempId: string, real: SocialComment) => void;
  onReplyFailed: (tempId: string) => void;
  onDeleted: (id: string) => void;
  isReply?: boolean;
}) {
  const [replying, setReplying] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pending = comment.id.startsWith("temp_");
  const showReply = replying && !pending;

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await apiSend(`/api/comments/${comment.id}`, "DELETE");
      onDeleted(comment.id);
      toast("Comment deleted");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete", "negative");
      setDeleting(false);
    }
  };

  return (
    <article className={cn("card p-4", isReply && "border-0 border-l border-border bg-transparent py-3 pl-4 pr-0 rounded-none", pending && "opacity-60")}>
      <div className="flex items-start gap-3">
        <TraderAvatar name={comment.author.displayName} id={comment.author.id} size={isReply ? "xs" : "sm"} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span className="font-medium text-primary">{comment.author.displayName}</span>
            {comment.mine && <span className="rounded border border-border px-1 text-[10px] text-muted">you</span>}
            <TimeAgo value={comment.createdAt} className="text-muted" />
          </div>
          <div className="mt-1">
            <RichBody body={comment.body} refs={comment.refs} className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-primary" />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <VoteButtons targetType="comment" targetId={comment.id} upvotes={comment.upvotes} downvotes={comment.downvotes} myVote={comment.myVote} size="sm" />
            {!isReply && (
              <button
                type="button"
                onClick={() => setReplying((v) => !v)}
                disabled={pending}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-primary"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Reply
                {comment.replyCount > 0 && <span className="tnum">· {comment.replyCount}</span>}
              </button>
            )}
            {comment.mine && !pending && (
              <button type="button" onClick={remove} disabled={deleting} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-negative">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
            {!comment.mine && !pending && (
              <button type="button" onClick={() => setReporting(true)} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-primary">
                <Flag className="h-3.5 w-3.5" />
                Report
              </button>
            )}
            {targetType === "post" && !isReply && (
              <Link href={`/social/${targetId}#${comment.id}`} className="ml-auto text-xs text-muted hover:text-primary">
                Link
              </Link>
            )}
          </div>

          {showReply && (
            <div className="mt-3">
              <CommentComposer
                targetType={targetType}
                targetId={targetId}
                parentId={comment.id}
                placeholder={`Reply to ${comment.author.displayName}…`}
                autoFocus
                compact
                onOptimistic={onReply}
                onCreated={(real, tempId) => {
                  onReplyCreated(tempId, real);
                  setReplying(false);
                }}
                onFailed={onReplyFailed}
                onCancel={() => setReplying(false)}
              />
            </div>
          )}

          {comment.replies && comment.replies.length > 0 && (
            <div className="mt-3 space-y-1">
              {comment.replies.map((r) => (
                <CommentCard key={r.id} comment={r} targetType={targetType} targetId={targetId} onReply={onReply} onReplyCreated={onReplyCreated} onReplyFailed={onReplyFailed} onDeleted={onDeleted} isReply />
              ))}
            </div>
          )}
        </div>
      </div>
      <ReportDialog open={reporting} onOpenChange={setReporting} targetType="comment" targetId={comment.id} />
    </article>
  );
}
