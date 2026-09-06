"use client";

import { ArrowBigDown, ArrowBigUp } from "lucide-react";
import { useState } from "react";
import { apiSend } from "@/lib/client/fetcher";
import { useGuest } from "@/lib/client/guest";
import { toast } from "@/lib/client/toast";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  targetType: "post" | "comment";
  targetId: string;
  upvotes: number;
  downvotes: number;
  myVote: 1 | -1 | 0;
  size?: "sm" | "md";
  className?: string;
}

interface VoteState {
  upvotes: number;
  downvotes: number;
  myVote: 1 | -1 | 0;
}

export function VoteButtons({ targetType, targetId, upvotes, downvotes, myVote, size = "md", className }: Props) {
  const [state, setState] = useState<VoteState>({ upvotes, downvotes, myVote });
  const [synced, setSynced] = useState<VoteState>({ upvotes, downvotes, myVote });
  const [busy, setBusy] = useState(false);
  const { refresh } = useGuest();

  // Adopt fresh server props (e.g. after a refetch) without an effect.
  if (synced.upvotes !== upvotes || synced.downvotes !== downvotes || synced.myVote !== myVote) {
    const next = { upvotes, downvotes, myVote };
    setSynced(next);
    setState(next);
  }

  const cast = async (value: 1 | -1) => {
    if (busy) return;
    const next: 1 | -1 | 0 = state.myVote === value ? 0 : value;
    const prev = state;
    setState({
      upvotes: prev.upvotes + (next === 1 ? 1 : 0) - (prev.myVote === 1 ? 1 : 0),
      downvotes: prev.downvotes + (next === -1 ? 1 : 0) - (prev.myVote === -1 ? 1 : 0),
      myVote: next,
    });
    setBusy(true);
    try {
      const res = await apiSend<VoteState>("/api/votes", "POST", { targetType, targetId, value: next });
      setState(res);
      if (prev.myVote === 0 && next !== 0) void refresh();
    } catch (err) {
      setState(prev);
      toast(err instanceof Error ? err.message : "Vote failed", "negative");
    } finally {
      setBusy(false);
    }
  };

  const score = state.upvotes - state.downvotes;
  const iconSize = size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]";

  return (
    <div className={cn("inline-flex items-center rounded-lg border border-border bg-surface", size === "sm" ? "h-7" : "h-8", className)}>
      <button
        type="button"
        onClick={() => cast(1)}
        aria-pressed={state.myVote === 1}
        aria-label="Upvote"
        className={cn("flex h-full items-center rounded-l-lg px-1.5 transition-colors hover:bg-hover", state.myVote === 1 ? "text-neon" : "text-muted hover:text-primary")}
      >
        <ArrowBigUp className={cn(iconSize, state.myVote === 1 && "fill-current")} />
      </button>
      <span className={cn("min-w-6 px-0.5 text-center font-medium tnum", size === "sm" ? "text-xs" : "text-[13px]", score > 0 ? "text-primary" : score < 0 ? "text-negative" : "text-secondary")}>
        {formatCompact(score)}
      </span>
      <button
        type="button"
        onClick={() => cast(-1)}
        aria-pressed={state.myVote === -1}
        aria-label="Downvote"
        className={cn("flex h-full items-center rounded-r-lg px-1.5 transition-colors hover:bg-hover", state.myVote === -1 ? "text-negative" : "text-muted hover:text-primary")}
      >
        <ArrowBigDown className={cn(iconSize, state.myVote === -1 && "fill-current")} />
      </button>
    </div>
  );
}
