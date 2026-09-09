import { notFound } from 'next/navigation';
import Link from 'next/link';
import { addressSchema } from '@/lib/trading/shared';
import { IntelligenceHeader } from '@/components/intelligence/primitives';
import { TraderIntelligence } from '@/components/intelligence/trader-intelligence';
import { WalletEvidence } from '@/components/intelligence/wallet-evidence';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Wallet intelligence' };
export default async function WalletPage({ params }: { params: Promise<{ address: string }> }) {
  const parsed = addressSchema.safeParse((await params).address); if (!parsed.success) notFound();
  return <><IntelligenceHeader title="Wallet intelligence" description="Inspect recorded performance and evidence behind wallet relationships. Browsing does not require connecting a wallet." /><div className="mb-5 flex flex-wrap gap-3"><code className="break-all text-sm text-secondary">{parsed.data}</code><Link href={`/trader/${parsed.data}`} className="text-sm text-neon">Trader profile</Link></div><div className="space-y-5"><TraderIntelligence address={parsed.data} /><WalletEvidence address={parsed.data} /></div></>;
}
