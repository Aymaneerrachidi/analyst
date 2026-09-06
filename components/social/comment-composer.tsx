"use client";

import { useRef, useState, type FormEvent } from "react";
import { ApiError, apiSend } from "@/lib/client/fetcher";
import { useGuest } from "@/lib/client/guest";
import { toast } from "@/lib/client/toast";
import type { SocialComment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/states";
import { DisplayNameDialog } from "./display-name-dialog";

export const MAX_LEN = 500;

interface Props {
  targetType: "token" | "trader" | "post";
  targetId: string;
  parentId?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
  onOptimistic?: (temp: SocialComment) => void;
  onCreated: (comment: SocialComment, tempId: string) => void;
  onFailed?: (tempId: string) => void;
  onCancel?: () => void;
}

export function CommentComposer({ targetType, targetId, parentId = null, placeholder = "Share your take...", autoFocus, compact, onOptimistic, onCreated, onFailed, onCancel }: Props) {
  const { guest, needsName, loaded } = useGuest();
  const [body, setBody] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askName, setAskName] = useState(false);
  const askedRef = useRef(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    if (loaded && needsName && !askedRef.current) {
      askedRef.current = true;
      setAskName(true);
      return;
    }
    setBusy(true);
    setError(null);
    const tempId = `temp_${Date.now()}`;
    onOptimistic?.({
      id: tempId,
      author: { id: guest?.id ?? "me", displayName: guest?.displayName ?? "you" },
      targetType,
      targetId,
      parentId,
      body: text,
      refs: [],
      upvotes: 0,
      downvotes: 0,
      score: 0,
      replyCount: 0,
      createdAt: new Date().toISOString(),
      myVote: 0,
      mine: true,
      replies: [],
    });
    try {
      const res = await apiSend<{ comment: SocialComment }>("/api/comments", "POST", { targetType, targetId, parentId, body: text, website });
      setBody("");
      onCreated(res.comment, tempId);
    } catch (err) {
      onFailed?.(tempId);
      const message = err instanceof ApiError ? err.message : "Could not post your comment.";
      setError(message);
      if (err instanceof ApiError && err.status === 429) toast(message, "negative");
    } finally {
      setBusy(false);
    }
  };

  const remaining = MAX_LEN - body.length;

  return (
    <>
      <form onSubmit={submit} className={cn("card-elevated p-3", compact && "p-2.5")}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX_LEN))}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          placeholder={placeholder}
          rows={compact ? 2 : 3}
          autoFocus={autoFocus}
          aria-label={parentId ? "Write a reply" : "Write a comment"}
          className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-primary outline-none placeholder:text-muted"
        />
        <input
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          className="absolute -left-[9999px] h-px w-px opacity-0"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className={cn("tnum", remaining < 40 && "text-warning")}>{remaining}</span>
            {guest && <span className="hidden sm:inline">as {guest.displayName}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            {onCancel && (
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button type="submit" variant="primary" size="sm" disabled={busy || body.trim().length === 0}>
              {busy ? "Posting…" : parentId ? "Reply" : "Post"}
            </Button>
          </div>
        </div>
        {error && (
          <div className="mt-2">
            <InlineNotice tone="negative">{error}</InlineNotice>
          </div>
        )}
      </form>
      <DisplayNameDialog open={askName} onOpenChange={setAskName} onDone={() => void submit()} />
    </>
  );
}
