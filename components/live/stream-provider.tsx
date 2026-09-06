"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { AnalystTrade, AnalystTrader } from "@/lib/types";
import { mergeLiveTrades, parseLiveTrade } from "@/lib/client/live-trades";

type Stream = { enabled: boolean; status: "connecting" | "live" | "reconnecting"; trades: AnalystTrade[]; traders: Map<string, AnalystTrader> };
const StreamContext = createContext<Stream>({ enabled: false, status: "connecting", trades: [], traders: new Map() });
export const useTradeStream = () => useContext(StreamContext);

export function TradeStreamProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [status, setStatus] = useState<Stream["status"]>("connecting");
  const [trades, setTrades] = useState<AnalystTrade[]>([]);
  const [traders, setTraders] = useState(new Map<string, AnalystTrader>());
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let disposed = false;
    let snapshotPending = false;
    const receive = (values: unknown[]) => {
      const parsed = values.map(parseLiveTrade).filter((t): t is AnalystTrade => t !== null);
      if (!disposed && parsed.length) setTrades(previous => mergeLiveTrades(previous, parsed, 500));
    };
    const snapshot = async () => {
      if (snapshotPending) return;
      snapshotPending = true;
      try {
        const response = await fetch("https://kolhood.io/api/trades?limit=100", { cache: "no-store", signal: controller.signal });
        if (response.ok) { const body = await response.json(); if (Array.isArray(body.data)) receive(body.data); }
      } catch { /* The socket and saved database remain available independently. */ }
      finally { snapshotPending = false; }
    };
    void fetch("/api/traders?period=7d&limit=200", { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(body => {
      if (!disposed && Array.isArray(body?.traders)) setTraders(new Map(body.traders.map((t: AnalystTrader) => [t.id, t])));
    }).catch(() => undefined);
    // This is the public, unauthenticated event channel used by KOLHOOD's own feed.
    const socket = io("https://kolhood.io", { transports: ["websocket"], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000, timeout: 10000 });
    socket.on("connect", () => { setStatus("live"); void snapshot(); });
    socket.on("trade:new", (trade: unknown) => receive([trade]));
    socket.on("disconnect", () => setStatus("reconnecting"));
    socket.on("connect_error", () => setStatus("reconnecting"));
    // Reconcile missed events on reconnect/tab return and while the socket is unavailable.
    const interval = setInterval(() => { if (!socket.connected) void snapshot(); }, 5000);
    const visible = () => { if (document.visibilityState === "visible") { if (!socket.connected) socket.connect(); void snapshot(); } };
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", visible); socket.removeAllListeners(); socket.disconnect(); };
  }, [enabled]);
  return <StreamContext.Provider value={{ enabled, status, trades, traders }}>{children}</StreamContext.Provider>;
}
