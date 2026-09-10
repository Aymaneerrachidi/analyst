import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatUsd } from '@/lib/format';
export const knownUsd = (value: number | null | undefined) => value == null ? 'Not measured' : formatUsd(value);
export const knownPercent = (value: number | null | undefined) => value == null ? 'Not measured' : `${value.toFixed(1)}%`;
export function IntelligenceNav() {
  return <nav aria-label="Intelligence tools" className="flex flex-wrap gap-2 py-4">{[['/radar', 'Why is it pumping?'], ['/signals', 'Signal history'], ['/narratives', 'Narratives'], ['/compare', 'Compare'], ['/feed', 'Your feed'], ['/positions', 'Positions']].map(([href, label]) => <Link key={href} href={href} className="rounded-full border border-border px-3 py-2 text-xs text-secondary hover:border-neon hover:text-neon">{label}</Link>)}</nav>;
}
export function IntelligenceHeader({ title, description }: { title: string; description: string }) {
  return <header className="py-6"><p className="label-caps text-neon">Analyst intelligence</p><h1 className="mt-2 text-3xl font-medium tracking-tight">{title}</h1><p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-secondary">{description}</p><IntelligenceNav /></header>;
}
export function EvidenceMetric({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className="min-w-0"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words text-base font-medium tnum">{children}</dd>{hint && <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>}</div>;
}
export function Coverage({ children }: { children: ReactNode }) { return <p className="mt-4 max-w-[75ch] text-xs leading-relaxed text-muted">{children}</p>; }
