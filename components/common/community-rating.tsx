"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useState } from "react";
import { apiGet, apiSend } from "@/lib/client/fetcher";
import { toast } from "@/lib/client/toast";
import { formatCount, formatRating } from "@/lib/format";
import type { RatingSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface Props {
  targetType: "token" | "trader";
  targetId: string;
  initial?: { average: number | null; count: number };
  variant?: "inline" | "card";
  label?: string;
}

function useRating(targetType: Props["targetType"], targetId: string, initial?: Props["initial"]) {
  return useQuery({
    queryKey: ["rating", targetType, targetId],
    queryFn: () => apiGet<RatingSummary>(`/api/ratings?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`),
    initialData: initial
      ? { targetType, targetId, average: initial.average, count: initial.count, mine: null, distribution: Array.from({ length: 10 }, () => 0) }
      : undefined,
    staleTime: 15_000,
  });
}

/** Community rating (1–10). Distinct from the algorithmic Analyst Score. Anyone can rate; one rating per visitor per target. */
export function CommunityRating({ targetType, targetId, initial, variant = "inline", label }: Props) {
  const qc = useQueryClient();
  const { data } = useRating(targetType, targetId, initial);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: (score: number) => apiSend<RatingSummary>("/api/ratings", "POST", { targetType, targetId, score }),
    onSuccess: (summary) => {
      qc.setQueryData(["rating", targetType, targetId], summary);
      toast(summary.mine ? `Rated ${summary.mine}/10` : "Rating saved", "positive");
      setOpen(false);
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Could not save rating", "negative"),
  });

  const average = data?.average ?? null;
  const count = data?.count ?? 0;
  const mine = data?.mine ?? null;
  const preview = hover ?? mine;

  const picker = (
    <div>
      <p className="label-caps mb-2">{mine ? "Update your rating" : `Rate this ${targetType}`}</p>
      <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label="Rating from 1 to 10">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const active = preview !== null && n <= preview;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={mine === n}
              aria-label={`${n} out of 10`}
              disabled={mutation.isPending}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(null)}
              onClick={() => mutation.mutate(n)}
              className={cn(
                "h-8 rounded-md border text-[13px] font-medium tnum transition-colors",
                active ? "border-neon/50 bg-neon/15 text-neon" : "border-border bg-surface text-secondary hover:border-border-hover hover:text-primary",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>{preview ? `${preview} / 10` : "Pick a number"}</span>
        {data?.distribution && count > 0 && <span>{formatCount(count)} ratings</span>}
      </div>
      {data?.distribution && count > 0 && (
        <div className="mt-2 flex h-6 items-end gap-0.5" aria-hidden>
          {data.distribution.map((n, i) => (
            <div key={i} className="flex-1 rounded-sm bg-white/[0.08]" style={{ height: `${Math.max(8, (n / Math.max(...data.distribution, 1)) * 100)}%` }} />
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">Community sentiment, not an algorithmic score. No account needed.</p>
    </div>
  );

  if (variant === "card") {
    return (
      <div className="card p-5">
        <p className="label-caps">{label ?? "Community"}</p>
        <div className="mt-2 flex items-end gap-2">
          <span className="text-4xl font-semibold leading-none tracking-tight tnum">{formatRating(average)}</span>
          <span className="pb-0.5 text-sm text-muted">/ 10</span>
        </div>
        <p className="mt-1 text-xs text-muted">{count > 0 ? `${formatCount(count)} ${count === 1 ? "rating" : "ratings"}` : "No ratings yet"}</p>
        <div className="mt-4">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant={mine ? "secondary" : "primary"} size="sm" className="w-full">
                <Star className={cn("h-3.5 w-3.5", mine && "fill-current")} />
                {mine ? `You rated ${mine}/10` : `Rate this ${targetType}`}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              {picker}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-hover"
          aria-label={`Community rating ${formatRating(average)} out of 10 from ${count} ratings. Rate this ${targetType}`}
        >
          <Star className={cn("h-3.5 w-3.5", mine ? "fill-neon text-neon" : "text-muted")} />
          <span className="font-medium tnum">{formatRating(average)}</span>
          {count > 0 && <span className="text-xs text-muted tnum">({formatCount(count)})</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        {picker}
      </PopoverContent>
    </Popover>
  );
}
