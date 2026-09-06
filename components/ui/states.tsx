import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("card flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-3 h-8 w-8 rounded-full border border-border bg-elevated" aria-hidden />
      <p className="text-sm font-medium text-primary">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-secondary">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong.", description, action }: { title?: string; description?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center border-negative/30 px-6 py-14 text-center">
      <p className="text-sm font-medium text-primary">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-secondary">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function InlineNotice({ tone = "muted", children }: { tone?: "muted" | "warning" | "negative"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "text-[13px]",
        tone === "muted" && "text-muted",
        tone === "warning" && "text-warning",
        tone === "negative" && "text-negative",
      )}
      role={tone === "negative" ? "alert" : undefined}
    >
      {children}
    </p>
  );
}
