"use client";

import { relativeTime, relativeTimeLong } from "@/lib/format";
import { useNow } from "@/lib/client/time";
import { cn } from "@/lib/utils";

export function TimeAgo({ value, long, className }: { value: string | null | undefined; long?: boolean; className?: string }) {
  const now = useNow();
  if (!value) return <span className={cn("text-muted", className)}>—</span>;
  const iso = new Date(value).toISOString();
  return (
    <time dateTime={iso} title={new Date(value).toLocaleString()} className={cn("tnum", className)} suppressHydrationWarning>
      {long ? relativeTimeLong(value, now) : relativeTime(value, now)}
    </time>
  );
}
