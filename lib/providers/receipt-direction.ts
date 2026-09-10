import type { UpstreamTrade } from './types';

const transfer = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/** A transaction initiator is not necessarily the recipient of every routed
 * token. Only direct net token movements support wallet buy/sell attribution. */
export function receiptSupportsTrade(receipt: unknown, trade: Pick<UpstreamTrade, 'wallet' | 'tokenAddress' | 'side' | 'txHash'>): boolean {
  if (!receipt || typeof receipt !== 'object') return false;
  const r = receipt as { status?: string; transactionHash?: string; logs?: { address?: string; topics?: string[]; data?: string; removed?: boolean }[] };
  if (r.status !== '0x1' || r.transactionHash?.toLowerCase() !== trade.txHash?.toLowerCase() || !Array.isArray(r.logs)) return false;
  let net = BigInt(0);
  for (const log of r.logs) {
    if (log.removed || log.address?.toLowerCase() !== trade.tokenAddress.toLowerCase() || log.topics?.length !== 3 || log.topics[0] !== transfer || !/^0x[\da-f]{64}$/i.test(log.data ?? '')) continue;
    const from = `0x${log.topics[1].slice(-40)}`.toLowerCase();
    const to = `0x${log.topics[2].slice(-40)}`.toLowerCase();
    if (to === trade.wallet.toLowerCase()) net += BigInt(log.data!);
    if (from === trade.wallet.toLowerCase()) net -= BigInt(log.data!);
  }
  return trade.side === 'BUY' ? net > BigInt(0) : net < BigInt(0);
}
