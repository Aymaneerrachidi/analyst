import Link from "next/link";
import type { ReactNode } from "react";
import type { ContentRef } from "@/lib/types";

const TOKEN_RE = /(\$[A-Za-z][A-Za-z0-9]{1,15}\b|(?<![A-Za-z0-9_])@[A-Za-z][A-Za-z0-9_]{1,23}\b)/g;

/** Renders a post/comment body with resolved cashtags and mentions as links. */
export function RichBody({ body, refs, className }: { body: string; refs: ContentRef[]; className?: string }) {
  const byLabel = new Map(refs.map((r) => [r.label.toLowerCase(), r]));
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(body.slice(last, start));
    const label = m[0];
    const ref = byLabel.get(label.toLowerCase());
    if (ref) {
      parts.push(
        <Link key={key++} href={ref.href} className={ref.kind === "token" ? "font-medium text-neon hover:underline" : "font-medium text-primary hover:underline"}>
          {label}
        </Link>,
      );
    } else {
      parts.push(label);
    }
    last = start + label.length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return <p className={className ?? "whitespace-pre-wrap break-words text-[15px] leading-relaxed text-primary"}>{parts}</p>;
}
