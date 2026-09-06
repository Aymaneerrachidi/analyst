"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { apiGet } from "@/lib/client/fetcher";
import { formatPrice, formatPct, formatUsdSigned, shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TokenAvatar, TraderAvatar } from "@/components/common/avatar";

// ---- tiny external store so any button can open the palette ---------------
let openState = false;
const listeners = new Set<() => void>();
function setOpen(v: boolean) {
  openState = v;
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSearchCommand() {
  const open = useSyncExternalStore(subscribe, () => openState, () => false);
  return { isOpen: open, open: () => setOpen(true), close: () => setOpen(false) };
}

interface SearchResponse {
  tokens: { address: string; symbol: string; name: string; image?: string | null; price: number | null; priceChange24h: number | null }[];
  traders: { id: string; name: string; handle: string; wallet: string; avatar?: string | null; realizedPnl: number | null }[];
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function SearchCommandDialog() {
  const { isOpen, close } = useSearchCommand();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 120);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!openState);
      } else if (e.key === "/" && !typing && !openState) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: ({ signal }) => apiGet<SearchResponse>(`/api/search?q=${encodeURIComponent(debounced)}`, signal),
    enabled: isOpen && debounced.length > 0,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const go = useCallback(
    (href: string) => {
      close();
      setQuery("");
      router.push(href);
    },
    [close, router],
  );

  const tokens = debounced ? (data?.tokens ?? []) : [];
  const traders = debounced ? (data?.traders ?? []) : [];
  const empty = debounced.length > 0 && !isFetching && tokens.length === 0 && traders.length === 0;

  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery("");
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-elevated shadow-2xl shadow-black/60 outline-none data-[state=open]:animate-fade-in"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <Command shouldFilter={false} label="Search tokens and traders">
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="h-4 w-4 text-muted" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search tokens, symbols, traders, wallets…"
                className="h-12 flex-1 bg-transparent text-[15px] text-primary outline-none placeholder:text-muted focus-visible:outline-none"
              />
              <kbd className="hidden rounded border border-border bg-surface px-1.5 py-px font-mono text-[10px] text-muted sm:inline">ESC</kbd>
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              {debounced.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-muted">
                  Try <span className="text-secondary">$PONS</span>, a trader name, or paste a contract address.
                </div>
              )}
              {empty && <Command.Empty className="px-3 py-8 text-center text-sm text-muted">Nothing matched “{debounced}”.</Command.Empty>}
              {tokens.length > 0 && (
                <Command.Group heading="TOKENS" className="[&_[cmdk-group-heading]]:label-caps [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  {tokens.map((t) => (
                    <Command.Item
                      key={t.address}
                      value={`token-${t.address}`}
                      onSelect={() => go(`/token/${t.address}`)}
                      className={itemClass}
                    >
                      <TokenAvatar symbol={t.symbol} address={t.address} image={t.image} size="sm" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-medium text-primary">${t.symbol}</span>
                        <span className="truncate text-xs text-muted">{t.name} · {shortAddress(t.address)}</span>
                      </span>
                      <span className="text-right text-xs tnum">
                        <span className="block text-secondary">{formatPrice(t.price)}</span>
                        {t.priceChange24h !== null && (
                          <span className={t.priceChange24h >= 0 ? "text-positive" : "text-negative"}>{formatPct(t.priceChange24h)}</span>
                        )}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {traders.length > 0 && (
                <Command.Group heading="TRADERS" className="[&_[cmdk-group-heading]]:label-caps [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  {traders.map((t) => (
                    <Command.Item key={t.id} value={`trader-${t.id}`} onSelect={() => go(`/trader/${t.id}`)} className={itemClass}>
                      <TraderAvatar name={t.name} id={t.id} avatar={t.avatar} size="sm" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-medium text-primary">{t.name}</span>
                        <span className="truncate font-mono text-xs text-muted">{shortAddress(t.wallet)}</span>
                      </span>
                      {t.realizedPnl !== null && (
                        <span className={cn("text-xs tnum", t.realizedPnl >= 0 ? "text-positive" : "text-negative")}>{formatUsdSigned(t.realizedPnl)}</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors data-[selected=true]:bg-hover aria-selected:bg-hover";
