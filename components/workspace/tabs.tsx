"use client";
import { Children, useId, useState, type ReactNode } from "react";
export function WorkspaceTabs({ labels, children, initial = 0 }: { labels: string[]; children: ReactNode; initial?: number }) {
  const [active, setActive] = useState(initial);
  const id = useId();
  return <div className="min-w-0"><div role="tablist" aria-label="Token activity" className="mb-4 flex overflow-x-auto border-b border-border">{labels.map((label, i) => <button key={label} id={`${id}-tab-${i}`} role="tab" aria-selected={active === i} aria-controls={`${id}-panel-${i}`} tabIndex={active === i ? 0 : -1} onKeyDown={(e) => { const next = e.key === "ArrowRight" ? (i + 1) % labels.length : e.key === "ArrowLeft" ? (i + labels.length - 1) % labels.length : e.key === "Home" ? 0 : e.key === "End" ? labels.length - 1 : null; if (next !== null) { e.preventDefault(); setActive(next); document.getElementById(`${id}-tab-${next}`)?.focus(); } }} onClick={() => setActive(i)} className={`min-h-11 whitespace-nowrap border-b-2 px-4 text-xs font-medium ${i === active ? "border-neon text-neon" : "border-transparent text-muted hover:text-primary"}`}>{label}</button>)}</div>{Children.toArray(children).map((child, i) => <div role="tabpanel" id={`${id}-panel-${i}`} aria-labelledby={`${id}-tab-${i}`} key={i} hidden={i !== active}>{child}</div>)}</div>;
}
