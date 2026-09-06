"use client";

import Link from "next/link";
import { LayoutGroup, motion } from "framer-motion";
import { useId } from "react";
import { cn } from "@/lib/utils";

export interface TabOption<T extends string> {
  value: T;
  label: string;
  href?: string;
}

interface Props<T extends string> {
  value: T;
  options: TabOption<T>[];
  onChange?: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}

/** Segmented control. Works as buttons (onChange) or links (href per option) for server-rendered pages. */
export function FilterTabs<T extends string>({ value, options, onChange, size = "md", className, ariaLabel }: Props<T>) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-surface p-1 no-scrollbar", className)}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          const inner = (
            <>
              {active && (
                <motion.span
                  layoutId="active"
                  className="absolute inset-0 rounded-full border border-neon/20 bg-neon/10"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <span className={cn("relative", active ? "text-neon" : "text-secondary")}>{opt.label}</span>
            </>
          );
          const cls = cn(
            "relative inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full font-medium transition-colors hover:bg-hover tnum",
            size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-[13px]",
          );
          if (opt.href) {
            return (
              <Link key={opt.value} href={opt.href} aria-current={active ? "true" : undefined} className={cls} scroll={false}>
                {inner}
              </Link>
            );
          }
          return (
            <button key={opt.value} type="button" aria-pressed={active} onClick={() => onChange?.(opt.value)} className={cls}>
              {inner}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
