"use client";
import { createContext, useContext, useEffect, useState } from 'react';
import type { AnalystTrade, AnalystTrader } from '@/lib/types';
import { mergeLiveTrades } from '@/lib/client/live-trades';
type Stream = { enabled: boolean; status: 'connecting' | 'live' | 'delayed' | 'reconnecting'; trades: AnalystTrade[]; traders: Map<string, AnalystTrader> };
const StreamContext = createContext<Stream>({ enabled: false, status: 'connecting', trades: [], traders: new Map() });
export const useTradeStream = () => useContext(StreamContext);
export function TradeStreamProvider({ enabled, shared = false, children }: { enabled: boolean; shared?: boolean; children: React.ReactNode }) {
  const [status, setStatus] = useState<Stream['status']>('connecting');
  const [trades, setTrades] = useState<AnalystTrade[]>([]);
  const [traders, setTraders] = useState(new Map<string, AnalystTrader>());
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController(); let disposed = false, pending = false, lastHeartbeat = 0, afterSeq = 0;
    const receive = (values: AnalystTrade[]) => { if (!disposed && values.length) setTrades(previous => mergeLiveTrades(previous, values, 500)); };
    const snapshot = async () => { if (pending) return; pending = true; try { const response = await fetch(`/api/events/snapshot${afterSeq ? `?after=${afterSeq}` : ''}`, { cache: 'no-store', signal: controller.signal }); if (response.ok) { const body = await response.json(); if (Array.isArray(body.trades)) { receive(body.trades); for (const trade of body.trades) if (Number.isSafeInteger(trade.seq)) afterSeq = Math.max(afterSeq, trade.seq); } } } catch { /* Retain last confirmed data. */ } finally { pending = false; } };
    void fetch('/api/traders?period=7d&limit=500', { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(body => { if (!disposed && Array.isArray(body?.traders)) setTraders(new Map(body.traders.map((t: AnalystTrader) => [t.id, t]))); }).catch(() => undefined);
    void snapshot();
    const events = shared ? new EventSource('/api/events') : null;
    const heartbeat = (event: MessageEvent) => { try { const data = JSON.parse(event.data); lastHeartbeat = Date.now(); setStatus(data.upstream === 'live' ? 'live' : data.upstream === 'delayed' ? 'delayed' : 'reconnecting'); } catch { setStatus('reconnecting'); } };
    events?.addEventListener('status', heartbeat);
    events?.addEventListener('heartbeat', heartbeat);
    events?.addEventListener('trade', (event: MessageEvent) => { try { receive([JSON.parse(event.data)]); } catch { /* Ignore malformed transport frames. */ } });
    events?.addEventListener('indexed', () => void snapshot());
    events?.addEventListener('open', () => void snapshot());
    events?.addEventListener('error', () => setStatus('reconnecting'));
    // Reconcile missed data through Analyst only. No external provider calls in browsers.
    const interval = setInterval(() => { if (!shared || Date.now() - lastHeartbeat > 30_000) { if (shared) setStatus('reconnecting'); void snapshot(); } }, 10_000);
    const visible = () => { if (document.visibilityState === 'visible') void snapshot(); };
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; controller.abort(); events?.close(); clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [enabled, shared]);
  return <StreamContext.Provider value={{ enabled, status, trades, traders }}>{children}</StreamContext.Provider>;
}
