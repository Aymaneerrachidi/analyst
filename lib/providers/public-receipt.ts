import { formatUnits } from 'viem';
import type { UpstreamTrade } from './types';

export const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
export const V4_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const V4_SWAP = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
export interface Receipt { status: string; transactionHash: string; blockHash: string; blockNumber: string; logs: { address: string; topics: string[]; data: string; removed?: boolean }[] }
export interface TokenMeta { symbol: string; name: string; decimals: number }
const address = /^0x[0-9a-f]{40}$/;
/** Strict ERC20 deltas; ERC721, reverted and removed receipts never become fills. */
export function receiptMovements(receipt: Receipt, wallets: Set<string>) {
  if (receipt.status !== '0x1' || receipt.logs.some(l => l.removed)) return [];
  if (!receipt.logs.some(l => l.address.toLowerCase() === V4_MANAGER && l.topics[0] === V4_SWAP)) return [];
  const transfers = receipt.logs.flatMap(l => {
    if (l.topics[0] !== TRANSFER || l.topics.length !== 3 || !/^0x[0-9a-f]{64}$/i.test(l.data)) return [];
    const token = l.address.toLowerCase(), from = '0x' + l.topics[1].slice(-40).toLowerCase(), to = '0x' + l.topics[2].slice(-40).toLowerCase();
    return address.test(token) && address.test(from) && address.test(to) ? [{ token, from, to, amount: BigInt(l.data) }] : [];
  });
  const touched = [...wallets].filter(w => transfers.some(t => t.from === w || t.to === w));
  // A shared relay cash leg cannot be apportioned safely across several tracked wallets.
  if (touched.length !== 1) return [];
  const wallet = touched[0];
  const deltas = new Map<string, bigint>();
  for (const t of transfers) deltas.set(t.token, (deltas.get(t.token) ?? BigInt(0)) + (t.to === wallet ? t.amount : BigInt(0)) - (t.from === wallet ? t.amount : BigInt(0)));
  const assets = [...deltas].filter(([token, n]) => token !== USDG && n !== BigInt(0));
  if (assets.length !== 1) return [];
  const [token, delta] = assets[0], buy = delta > BigInt(0), amount = buy ? delta : -delta;
  if (!transfers.some(t => t.token === token && (t.from === V4_MANAGER || t.to === V4_MANAGER))) return [];
  let cash = deltas.get(USDG) ?? BigInt(0);
  let attribution = 'wallet-cash';
  if (cash === BigInt(0)) {
    // Relay settlement: require a single wallet edge, an exact matching token
    // boundary, and one USDG cash leg. Never assign a whole receipt's cash to each token.
    const edges = transfers.filter(t => t.token === token && (t.from === wallet || t.to === wallet));
    if (edges.length !== 1 || edges[0].amount !== amount) return [];
    const relay = buy ? edges[0].from : edges[0].to;
    const boundary = transfers.filter(t => t.from === relay || t.to === relay);
    if (boundary.some(t => t.token !== token && t.token !== USDG)) return [];
    const tokenOut = boundary.filter(t => t.token === token && t.from === relay);
    const tokenIn = boundary.filter(t => t.token === token && t.to === relay);
    if (tokenOut.length !== 1 || tokenIn.length !== 1 || tokenOut[0].amount !== amount || tokenIn[0].amount !== amount) return [];
    const paid = boundary.filter(t => t.token === USDG && (buy ? t.from === relay : t.to === relay));
    if (paid.length !== 1 || paid[0].amount <= BigInt(0)) return [];
    cash = buy ? -paid[0].amount : paid[0].amount;
    attribution = 'relay-cash';
  }
  if ((cash > BigInt(0)) === buy) return [];
  return [{ wallet, token, amount, cash: cash < BigInt(0) ? -cash : cash, side: buy ? 'BUY' as const : 'SELL' as const, attribution }];
}
export function normalizeMovement(m: ReturnType<typeof receiptMovements>[number], receipt: Receipt, timestamp: string, meta: TokenMeta, usdQuote?: number): UpstreamTrade | null {
  const tokenAmount = Number(formatUnits(m.amount, meta.decimals));
  if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) return null;
  const amountUsd = usdQuote && Number.isFinite(usdQuote) && usdQuote > 0 ? Number(formatUnits(m.cash, 6)) * usdQuote : undefined;
  if (amountUsd !== undefined && (!Number.isFinite(amountUsd) || amountUsd <= 0)) return null;
  return { id: `public:4663:${receipt.transactionHash}:${m.wallet}:${m.token}:${m.side}`, txHash: receipt.transactionHash, wallet: m.wallet, tokenAddress: m.token, tokenSymbol: meta.symbol, tokenName: meta.name, side: m.side, tokenAmount, amountUsd, price: amountUsd === undefined ? undefined : amountUsd / tokenAmount, timestamp, dex: 'Uniswap v4' };
}
