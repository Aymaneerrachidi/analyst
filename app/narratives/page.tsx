import Link from 'next/link';
import { desc, eq, gte } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { IntelligenceHeader, Coverage } from '@/components/intelligence/primitives';
import { EmptyState } from '@/components/ui/states';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Narratives' };
export default async function NarrativesPage() {
  const db = await getDb();
  // eslint-disable-next-line react-hooks/purity -- Request-time cutoff in a dynamic server component.
  const now = Date.now();
  const reports = await db.selectDistinctOn([schema.whyPumpingReports.token], { report: schema.whyPumpingReports, token: schema.tokens }).from(schema.whyPumpingReports).innerJoin(schema.tokens, eq(schema.tokens.address, schema.whyPumpingReports.token)).where(gte(schema.whyPumpingReports.generatedAt, new Date(now - 86_400_000))).orderBy(schema.whyPumpingReports.token, desc(schema.whyPumpingReports.generatedAt)).limit(100);
  return <><IntelligenceHeader title="Market narratives" description="Research themes drawn from token reports requested by the community. No social-firehose scoring or invented trends." />{reports.length ? <div className="grid gap-5 md:grid-cols-2">{reports.map(({ report, token }) => <article key={report.id} className="card p-5"><Link href={`/token/${token.address}`} className="text-sm font-medium text-neon">${token.symbol}</Link><h2 className="mt-3 text-lg font-medium">{report.primaryCatalyst}</h2><p className="mt-3 text-sm leading-relaxed text-secondary">{report.narrative || report.summary}</p><Coverage>Base44 research · confidence {report.confidence}/100 · generated {report.generatedAt.toLocaleString()}. {report.expiresAt.getTime() < now ? 'Report has expired; revisit the token to request fresh research.' : 'Report within its cache window.'}</Coverage></article>)}</div> : <EmptyState title="No recent research themes yet." description="Open a token and choose “Why is this pumping?” to request a report. Validated reports appear here with their original timestamps." />}</>;
}
