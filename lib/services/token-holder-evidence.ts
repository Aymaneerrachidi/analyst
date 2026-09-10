import 'server-only';
import { hoodTokenEvidence } from '@/lib/providers/hoodexplorer';
import { holderConcentration } from '@/lib/intelligence/risk-model';
export async function tokenHolderEvidence(address: string) {
  const result = await hoodTokenEvidence(address);
  if (!result.data) return { ...result, data: null };
  const data = result.data;
  const concentration = holderConcentration(data.holders, BigInt(data.supply), new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']));
  return { ...result, data: { holders: concentration.holders.map(h => ({ address: h.address, percent: h.percent })), top10: concentration.top10, liquidity: data.liquidity, holderObservedAt: data.holderObservedAt, incomplete: data.holderIncomplete, image: data.image } };
}
