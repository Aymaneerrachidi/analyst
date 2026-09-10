"use client";
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/client/fetcher';
import type { ResearchState } from '@/lib/services/token-research';
export function TokenResearch({address}:{address:string}) {
  const [message,setMessage]=useState(''); const [sending,setSending]=useState(false);
  const url=`/api/tokens/${address}/research`;
  const query=useQuery({queryKey:['research',address],queryFn:({signal})=>apiGet<{configured:boolean;state:ResearchState|null}>(url,signal),staleTime:30_000,refetchInterval:q=>q.state.data?.state?.status==='pending'?5000:false});
  const state=query.data?.state; const pending=sending||state?.status==='pending';
  const run=async()=>{setSending(true);setMessage('');try{const r=await fetch(url,{method:'POST'});const j=await r.json();setMessage(j.message||j.error||'');await query.refetch();}catch{setMessage('Research could not be requested. Try again.');}finally{setSending(false)}};
  return <section className="card p-5" aria-label="AI market research"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-medium">What’s behind the move?</h2><p className="mt-1 text-xs text-secondary">AI interpretation of measured market and tracked-wallet activity.</p></div><button onClick={run} disabled={pending||!query.data?.configured} className="rounded-full bg-neon px-4 py-2 text-xs font-semibold text-background disabled:opacity-40">{pending?'Preparing research…':state?.report?'Refresh analysis':'Analyze this token'}</button></div>
  {!state?.report && !pending && <div className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-3">{[['01', 'Wallet activity', 'Who is buying and selling, with the recorded trade values.'], ['02', 'Market context', 'Available price data and the timing of the move.'], ['03', 'Evidence & limits', 'What the data supports, and what remains unverified.']].map(([n,title,description]) => <div key={n}><span className="font-mono text-[10px] text-neon">{n}</span><h3 className="mt-2 text-sm font-medium">{title}</h3><p className="mt-1 text-xs leading-relaxed text-muted">{description}</p></div>)}</div>}
  {pending && <p role="status" className="mt-5 border-t border-border pt-4 text-sm text-secondary">Reviewing the latest available trade snapshot. You can leave this page; the report is saved when ready.</p>}
  {state?.report&&<div className="mt-5 space-y-4 text-sm leading-relaxed"><p>{state.report.summary}</p><div className="grid gap-5 sm:grid-cols-2"><div><h3 className="mb-2 text-xs text-neon">Observed activity</h3><ul className="space-y-2 text-secondary">{state.report.observations.map((v,i)=><li key={i}>{v}</li>)}</ul></div><div><h3 className="mb-2 text-xs text-warning">Uncertainty & risks</h3><ul className="space-y-2 text-secondary">{state.report.risks.map((v,i)=><li key={i}>{v}</li>)}</ul></div></div><p className="text-[11px] text-muted">{state.report.confidence} confidence · Snapshot {new Date(state.at).toLocaleString()} · Partial wallet coverage. AI analysis can be wrong.</p></div>}
  {(message||state?.message)&&<p role="status" className="mt-3 text-xs text-secondary">{message||state?.message}</p>}
  {!query.data?.configured&&!query.isLoading&&<p className="mt-3 text-xs text-muted">Research is not connected yet.</p>}
  </section>;
}
