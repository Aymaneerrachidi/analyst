"use client";

import { Pencil } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { ApiError, apiSend } from "@/lib/client/fetcher";
import { useGuest } from "@/lib/client/guest";
import { toast } from "@/lib/client/toast";
import type { SocialPost } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/states";
import { TraderAvatar } from "@/components/common/avatar";
import { DisplayNameDialog } from "./display-name-dialog";
import { MAX_LEN } from "./comment-composer";

interface Props {
  onOptimistic?: (temp: SocialPost) => void;
  onCreated: (post: SocialPost, tempId: string) => void;
  onFailed?: (tempId: string) => void;
}

export function PostComposer({ onOptimistic, onCreated, onFailed }: Props) {
  const { guest, needsName, loaded } = useGuest();
  const [body, setBody] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askName, setAskName] = useState(false);
  const [editName, setEditName] = useState(false);
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
      body: text,
      refs: [],
      upvotes: 0,
      downvotes: 0,
      score: 0,
      replyCount: 0,
      createdAt: new Date().toISOString(),
      myVote: 0,
      mine: true,
    });
    try {
      const res = await apiSend<{ post: SocialPost }>("/api/social", "POST", { body: text, website });
      setBody("");
      onCreated(res.post, tempId);
      toast("Posted", "positive");
    } catch (err) {
      onFailed?.(tempId);
      setError(err instanceof ApiError ? err.message : "Could not publish your post.");
    } finally {
      setBusy(false);
    }
  };

  const remaining = MAX_LEN - body.length;

  return (
    <>
      <form onSubmit={submit} className="card-elevated p-5 md:p-6">
        <div className="flex items-start gap-3">
          <TraderAvatar name={guest?.displayName ?? "anon"} id={guest?.id ?? "anon"} size="sm" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <label htmlFor="post-body" className="mb-3 block text-sm font-medium">Share an observation</label>
            <textarea
              id="post-body"
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX_LEN))}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              placeholder="A trade worth watching? A token worth discussing?"
              rows={3}
              aria-label="Write a post"
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-primary outline-none placeholder:text-muted"
            />
            <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-px w-px opacity-0" />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className={cn("tnum", remaining < 40 && "text-warning")}>{remaining}</span>
            {guest && (
              <button type="button" onClick={() => setEditName(true)} className="inline-flex items-center gap-1 transition-colors hover:text-primary">
                as {guest.displayName}
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={busy || body.trim().length === 0}>
            {busy ? "Posting…" : "Post"}
          </Button>
        </div>
        {error && (
          <div className="mt-2">
            <InlineNotice tone="negative">{error}</InlineNotice>
          </div>
        )}
      </form>
      <DisplayNameDialog open={askName} onOpenChange={setAskName} onDone={() => void submit()} />
      <DisplayNameDialog open={editName} onOpenChange={setEditName} mode="edit" />
    </>
  );
}
