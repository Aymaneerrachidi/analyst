"use client";
import { UserCheck, UserPlus } from "lucide-react";
import type { AnalystTraderRef } from "@/lib/types";
import { updateTracking, useTracking } from "@/lib/client/tracking-store";
import { toast } from "@/lib/client/toast";
export function FollowButton({ trader, compact = false }: { trader: AnalystTraderRef; compact?: boolean }) {
  const state = useTracking();
  const followed = state.following.some((t) => t.id === trader.id.toLowerCase());
  const Icon = followed ? UserCheck : UserPlus;
  return <button type="button" aria-label={`${followed ? "Unfollow" : "Follow"} ${trader.name}`} aria-pressed={followed}
    className={`inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs ${followed ? "border-neon/30 text-neon" : "border-border text-secondary hover:text-primary"}`}
    onClick={() => {
      if (!followed && state.following.length >= 100) { toast("You can follow up to 100 traders on this device."); return; }
      const ok = updateTracking((s) => ({ ...s, following: followed ? s.following.filter((t) => t.id !== trader.id.toLowerCase()) : [...s.following.filter((t) => t.id !== trader.id.toLowerCase()), { id: trader.id.toLowerCase(), wallet: trader.wallet.toLowerCase(), name: trader.name, handle: trader.handle, avatar: trader.avatar }] }));
      toast(ok ? `${followed ? "Unfollowed" : "Following"} ${trader.name}` : "Allow browser storage to save followed traders.", ok ? "positive" : "negative");
    }}><Icon className="h-3.5 w-3.5" />{!compact && (followed ? "Following" : "Follow")}</button>;
}
