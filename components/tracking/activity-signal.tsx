"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AnalystToken } from "@/lib/types";
import { activitySignal } from "@/lib/activity-signal";
import { apiGet } from "@/lib/client/fetcher";
export function ActivitySignal({ token }: { token: AnalystToken }) {
  const [now, setNow] = useState(0);
  useEffect(() => { const update = () => setNow(Date.now()); update(); const timer = setInterval(update, 30_000); return () => clearInterval(timer); }, []);
  const query = useQuery({ queryKey: ["activity-screen", token.address, token.window], queryFn: ({ signal }) => apiGet<{ token: AnalystToken }>(`/api/tokens/${token.address}?window=${token.window}`, signal), refetchInterval: 30_000 });
  const current = query.data?.token ?? token;
  const result = activitySignal(current, now);
  const green = result.green && !query.isError;
  return <section className="card p-5"><p className="label-caps">Activity signal · {current.window.toUpperCase()}</p><h2 className={`mt-2 flex items-center gap-2 text-lg ${green ? "text-neon" : "text-secondary"}`}><span className={`h-2 w-2 rounded-full ${green ? "bg-neon" : "bg-muted"}`} />{green ? "Green activity signal" : "Criteria not met"}</h2><p className="mt-2 text-xs leading-relaxed text-muted">A screen for recent tracked accumulation. It does not predict returns.</p><details className="mt-3 text-xs"><summary className="cursor-pointer text-secondary">{result.checks.filter(c => c.met).length}/{result.checks.length} criteria · View reasons</summary><ul className="mt-3 space-y-2">{result.checks.map(c => <li className={c.met ? "text-neon" : "text-muted"} key={c.label}>{c.met ? "✓" : "○"} {c.label}</li>)}</ul></details>{query.isError && <p className="mt-2 text-xs text-warning">Refresh unavailable. Signal is inactive.</p>}</section>;
}
