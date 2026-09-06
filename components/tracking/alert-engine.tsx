"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTradeStream } from "@/components/live/stream-provider";
import { readTracking, updateTracking, useTracking } from "@/lib/client/tracking-store";
import { evaluateAlerts } from "@/lib/client/tracking-model";
import { mergeLiveTrades } from "@/lib/client/live-trades";
import { apiGet } from "@/lib/client/fetcher";
import { formatUsd } from "@/lib/format";
import { toast } from "@/lib/client/toast";
import type { AnalystTrade } from "@/lib/types";

export function AlertEngine() {
  const state = useTracking();
  const router = useRouter();
  const stream = useTradeStream();
  const active = state.rules.some((r) => r.enabled);
  const query = useQuery({ queryKey: ["alert-reconciliation"], enabled: active,
    queryFn: ({ signal }) => apiGet<{ trades: AnalystTrade[] }>("/api/trades?limit=200", signal), refetchInterval: 10_000, staleTime: 5_000 });
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const process = () => {
      if (disposed) return;
      const current = readTracking();
      const trades = mergeLiveTrades(query.data?.trades ?? [], stream.trades, 500);
      const alerts = evaluateAlerts(trades, current, Date.now());
      if (!alerts.length) return;
      const saved = updateTracking((s) => ({ ...s, inbox: [...alerts.reverse(), ...s.inbox].slice(0, 100), seen: [...s.seen, ...alerts.map((a) => a.id)].slice(-2000) }));
      if (!saved) return;
      const latest = alerts[0];
      const message = alerts.length > 1 ? `${alerts.length} trades matched your alerts` : `${latest.trader.name} ${latest.side === "BUY" ? "bought" : "sold"} ${formatUsd(latest.amountUsd)} of ${latest.symbol}`;
      toast(message, "neutral");
      if (current.desktop && "Notification" in window && Notification.permission === "granted") {
        try { const notice = new Notification("ANALYST trade alert", { body: message, tag: latest.id }); notice.onclick = () => { window.focus(); router.push("/alerts"); notice.close(); }; } catch { /* Inbox remains available on browsers without desktop notifications. */ }
      }
    };
    // Serialize evaluation across tabs so one trade generates one alert.
    if (navigator.locks) void navigator.locks.request("analyst:alerts", { ifAvailable: true }, (lock) => { if (lock) process(); });
    else if (document.visibilityState === "visible") process();
    return () => { disposed = true; };
  }, [active, state, stream.trades, query.data, router]);
  return null;
}
