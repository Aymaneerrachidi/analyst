"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PulseIcon, CoinsIcon, SquaresFourIcon, ChatCircleDotsIcon, UsersIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { isActivePath } from "./top-nav";

const ITEMS = [
  { href: "/", label: "Overview", icon: SquaresFourIcon, match: ["/"] },
  { href: "/live", label: "Live", icon: PulseIcon },
  { href: "/traders", label: "Traders", icon: UsersIcon, match: ["/traders", "/trader"] },
  { href: "/tokens", label: "Tokens", icon: CoinsIcon, match: ["/tokens", "/token"] },
  { href: "/radar", label: "Radar", icon: PulseIcon, match: ["/radar", "/signals", "/narratives", "/compare", "/wallet", "/positions", "/feed"] },
  { href: "/social", label: "Community", icon: ChatCircleDotsIcon },
] as const;

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <ul className="grid grid-cols-6">
        {ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" : isActivePath(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1.5 text-[10px] font-medium tracking-wide transition-colors",
                  active ? "text-neon" : "text-muted hover:text-secondary",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
