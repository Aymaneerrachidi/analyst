"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Star } from "lucide-react";
import type { AnalystTokenRef } from "@/lib/types";
import { TokenAvatar } from "@/components/common/avatar";
import { savePreferences } from '@/lib/client/preference-sync';

const key = "analyst:watchlist:v1";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("analyst:watchlist", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("analyst:watchlist", callback); };
}
function snapshot() { try { return localStorage.getItem(key) ?? "[]"; } catch { return "[]"; } }
export function useWatchlist(): AnalystTokenRef[] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  try { const items = JSON.parse(raw); return Array.isArray(items) ? items.filter((t) => /^0x[\da-f]{40}$/i.test(t?.address) && typeof t.symbol === "string" && typeof t.name === "string").slice(0, 200) : []; } catch { return []; }
}
export function WatchButton({ token }: { token: AnalystTokenRef }) {
  const items = useWatchlist();
  const [error, setError] = useState(false);
  const saved = items.some((t) => t.address.toLowerCase() === token.address.toLowerCase());
  return <span className="inline-flex flex-col gap-1"><button type="button" aria-pressed={saved} aria-label={saved ? `Remove ${token.symbol} from watchlist` : `Watch ${token.symbol}`} onClick={() => {
    try {
      const next = saved ? items.filter((t) => t.address.toLowerCase() !== token.address.toLowerCase()) : [...items, { address: token.address.toLowerCase(), name: token.name, symbol: token.symbol, image: token.image }].slice(-200);
      localStorage.setItem(key, JSON.stringify(next)); window.dispatchEvent(new Event("analyst:watchlist"));
      void savePreferences({ watchlist: next.map(t => t.address) });
      setError(false);
    } catch { setError(true); }
  }} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs ${saved ? "border-neon/40 text-neon" : "border-border text-secondary hover:text-primary"}`}><Star className="h-3.5 w-3.5" fill={saved ? "currentColor" : "none"} />{saved ? "Watching" : "Watch"}</button>{error && <span role="status" className="max-w-40 text-[11px] text-warning">Allow browser storage to save tokens.</span>}</span>;
}
export function WatchlistContent() {
  const items = useWatchlist();
  if (!items.length) return <div className="card p-8 text-center"><Star className="mx-auto mb-4 h-6 w-6 text-neon" /><h2 className="font-medium">Your next move starts here.</h2><p className="mt-2 text-sm text-secondary">Star a token to keep it close. Your watchlist stays in this browser.</p><Link href="/tokens" className="mt-5 inline-flex rounded-lg bg-neon px-4 py-2 text-sm font-medium text-background">Explore tokens</Link></div>;
  return <ul className="card divide-y divide-border">{items.map((token) => <li key={token.address} className="flex items-center gap-3 p-4"><Link href={`/token/${token.address}`} className="flex min-w-0 flex-1 items-center gap-3"><TokenAvatar {...token} size="md" /><span className="truncate"><strong className="block font-medium">{token.symbol}</strong><span className="text-xs text-muted">{token.name}</span></span></Link><WatchButton token={token} /></li>)}</ul>;
}
