"use client";
import Link from "next/link";
import { Bell, Users } from "lucide-react";
import { useTracking } from "@/lib/client/tracking-store";
export function TrackingLinks() {
  const state = useTracking();
  const unread = state.inbox.filter((a) => !a.read).length;
  return <div className="flex items-center gap-1"><Link href="/following" aria-label="Followed traders" title="Followed traders" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-secondary hover:text-neon"><Users className="h-4 w-4" /></Link><Link href="/alerts" aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`} title="Alerts" className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-secondary hover:text-neon"><Bell className="h-4 w-4" />{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-neon px-1 text-[9px] text-background">{unread > 9 ? "9+" : unread}</span>}</Link></div>;
}
