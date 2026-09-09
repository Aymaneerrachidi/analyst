import Link from 'next/link';
import { getWalletTokenSnapshot } from '@/lib/services/wallet-token-data';
import { formatUsd, formatUsdSigned } from '@/lib/format';

export async function TokenPerformance({ wallet, period }: { wallet: string; period: string }) {
  const snapshot = await getWalletTokenSnapshot(wallet);
  const rows = snapshot?.metrics.filter(r => r.period === period).sort((a, b) => (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity)) ?? [];
  if (!snapshot || !rows.length) return null;
  const money = (value: number | null) => value == null ? 'Unavailable' : formatUsd(value);
  return <section className="space-y-3">
    <div><h2 className="text-lg font-medium">Profit by token</h2><p className="text-xs text-secondary">{period} performance · Saved {snapshot.capturedAt.replace('T', ' ').slice(0, 16)} UTC{snapshot.partial ? ' · Captured tokens; coverage may be incomplete' : ''}</p></div>
    <div className="card overflow-x-auto"><table className="w-full min-w-[700px] text-sm">
      <thead><tr className="border-b border-border">{['Token', 'Realized PnL', 'Bought', 'Sold', 'Buys / sells', 'Avg. hold'].map((label, i) => <th key={label} className={`label-caps px-4 py-3 ${i ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.address} className="border-b border-border last:border-b-0 hover:bg-hover">
        <td className="px-4 py-3"><Link href={`/token/${row.address}`} className="font-medium hover:underline" title={row.name}>{row.symbol}</Link></td>
        <td className={`px-4 py-3 text-right tnum ${row.pnl != null && row.pnl > 0 ? 'text-neon' : ''}`}>{row.pnl == null ? 'Unavailable' : formatUsdSigned(row.pnl)}</td>
        <td className="px-4 py-3 text-right tnum">{money(row.boughtUsd)}</td><td className="px-4 py-3 text-right tnum">{money(row.soldUsd)}</td>
        <td className="px-4 py-3 text-right tnum">{row.buys ?? '?'} / {row.sells ?? '?'}</td>
        <td className="px-4 py-3 text-right tnum">{row.holdingSeconds == null ? 'Unavailable' : row.holdingSeconds < 3600 ? `${Math.round(row.holdingSeconds / 60)}m` : `${(row.holdingSeconds / 3600).toFixed(1)}h`}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
