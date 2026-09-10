import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Geometric "A" mark: two strokes meeting at an apex with a floating crossbar. Original, not a feather. */
export function AnalystMark({ className }: { className?: string }) {
  return (
    <Image src="/analyst-logo.svg" alt="" aria-hidden width={24} height={24} unoptimized className={cn("h-5 w-5", className)} />
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
