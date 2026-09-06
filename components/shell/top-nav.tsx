"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MagnifyingGlassIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { Wordmark } from "./brand";
import { useSearchCommand } from "./search-command";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/live", label: "Live trades" },
  { href: "/traders", label: "Traders", match: ["/traders", "/trader"] },
  { href: "/tokens", label: "Tokens", match: ["/tokens", "/token"] },
  { href: "/social", label: "Community" },
] as const;

export function isActivePath(pathname: string, item: { href: string; match?: readonly string[] }): boolean {
  const patterns = item.match ?? [item.href];
  return patterns.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function TopNav() {
  const pathname = usePathname();
  const { open } = useSearchCommand();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-lg">
      <div className="app-container flex h-[72px] items-center justify-between gap-5 lg:h-20">
        <Wordmark />
        <nav className="hidden h-full items-center gap-5 lg:flex xl:gap-7" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const active = isActivePath(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative inline-flex h-full items-center whitespace-nowrap text-[13px] font-medium transition-colors",
                  active ? "text-neon" : "text-secondary hover:text-primary",
                )}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
                {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-neon" aria-hidden />}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={open}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-[13px] text-secondary transition-colors hover:border-border-hover hover:text-primary sm:w-44 sm:justify-between"
            aria-label="Search tokens and traders"
          >
            <span className="inline-flex items-center gap-2">
              <MagnifyingGlassIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Search anything</span>
            </span>
            <kbd className="hidden rounded border border-border px-1.5 py-px font-mono text-[10px] text-muted sm:inline">/</kbd>
          </button>
          <Link href="/live" className="hidden h-10 items-center gap-2 rounded-full bg-neon px-4 text-[13px] font-medium text-background transition-colors hover:bg-neon-hover xl:inline-flex">
            Explore trades <ArrowUpRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
