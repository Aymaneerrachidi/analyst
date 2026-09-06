import Link from "next/link";
import { cn } from "@/lib/utils";

/** Geometric "A" mark: two strokes meeting at an apex with a floating crossbar. Original, not a feather. */
export function AnalystMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("h-5 w-5", className)}>
      <path d="M12 3 3.5 21h3.2L12 9.4 17.3 21h3.2L12 3Z" fill="currentColor" />
      <rect x="9" y="15.2" width="6" height="2.2" rx="0.6" fill="var(--background)" />
      <rect x="9.6" y="15.8" width="4.8" height="1" rx="0.4" fill="var(--robin-neon)" />
    </svg>
  );
}

export function Wordmark({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("group inline-flex shrink-0 items-center gap-2.5 text-primary", className)} aria-label="ANALYST home">
      <AnalystMark className="h-7 w-7 text-neon transition-transform group-hover:-translate-y-0.5" />
      <span className="text-[24px] font-semibold tracking-[-0.065em]">analyst<span className="text-neon">.</span></span>
    </Link>
  );
}
