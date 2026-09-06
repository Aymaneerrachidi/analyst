import Link from "next/link";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionHeader({
  title,
  eyebrow,
  description,
  action,
  href,
  hrefLabel,
  className,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  action?: ReactNode;
  href?: string;
  hrefLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-xs font-medium text-muted">{eyebrow}</p>}
        <h2 className="text-xl font-medium tracking-[-0.035em] text-primary md:text-2xl">{title}</h2>
        {description && <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-secondary">{description}</p>}
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-3">
        {action}
        {href && (
          <Link href={href} className="group inline-flex min-h-9 items-center gap-1.5 text-[13px] font-medium text-secondary transition-colors hover:text-neon">
            {hrefLabel ?? "View all"}
            <ArrowUpRightIcon className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

export function PageHeader({ title, description, children, className }: { title: string; description?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-border py-5", className)}>
      <div>
        <h1 className="text-2xl font-medium tracking-[-0.035em] text-primary md:text-[28px]">{title}</h1>
        {description && <p className="mt-3 max-w-xl text-sm leading-relaxed text-secondary md:text-[15px]">{description}</p>}
      </div>
      {children && <div className="flex max-w-full flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
