import 'server-only';
import { and, desc, eq, gte, or } from 'drizzle-orm';
import { erc20Abi, parseAbi, zeroAddress, type Address } from 'viem';
import { getDb, schema } from '@/lib/db';
import { chainClient } from '@/lib/indexer/rpc';
import { explorerAddress, explorerContract, explorerHolders } from '@/lib/providers/blockscout';
import { sharedLoad } from '@/lib/v2/shared-cache';
import { classifyRisk, holderConcentration, type CheckState } from './risk-model';

const ownerAbi = parseAbi(['function owner() view returns (address)']);
export async function assessTokenRisk(address: Address) {
  return sharedLoad(`risk:${address}`, 300_000, async () => {
    const db = await getDb(), client = chainClient();
    const [contract, identity, holderResult, supplyResult, ownerResult, pools, profiles, markets] = await Promise.all([
      explorerContract(address), explorerAddress(address), explorerHolders(address),
      client.readContract({ address, abi: erc20Abi, functionName: 'totalSupply' }).catch(() => null),
      client.readContract({ address, abi: ownerAbi, functionName: 'owner' }).catch(() => null),
      db.select().from(schema.liquidityPools).where(or(eq(schema.liquidityPools.token0, address), eq(schema.liquidityPools.token1, address))),
      db.select().from(schema.tokenProfiles).where(eq(schema.tokenProfiles.address, address)).limit(1),
      db.select().from(schema.marketObservations).where(and(eq(schema.marketObservations.tokenAddress, address), gte(schema.marketObservations.timestamp, new Date(Date.now() - 180_000)))).orderBy(desc(schema.marketObservations.timestamp)).limit(1),
    ]);
    const creator = profiles[0]?.deployerAddress ?? (identity.stale ? null : identity.data?.creator_address_hash) ?? null;
    const source = contract.stale ? null : contract.data;
    const names = source?.abi?.filter(item => item.type === 'function').map(item => String(item.name).toLowerCase()) ?? [];
    const capability = (pattern: RegExp): CheckState => names.some(name => pattern.test(name)) ? 'PRESENT' : 'UNKNOWN';
    const excluded = new Set([zeroAddress, '0x000000000000000000000000000000000000dead', ...pools.map(p => p.address)]);
    const holderRows = !holderResult.stale ? holderResult.data?.items.map(h => ({ address: h.address.hash, raw: h.value })) ?? [] : [];
    const concentration = supplyResult != null && holderResult.data && !holderResult.stale ? holderConcentration(holderRows, supplyResult, excluded) : { top10: null, top20: null, holders: [] };
    const creatorBalance = creator && supplyResult && supplyResult > BigInt(0) ? await client.readContract({ address, abi: erc20Abi, functionName: 'balanceOf', args: [creator as Address] }).catch(() => null) : null;
    const creatorPercent = creatorBalance != null && supplyResult ? Number(creatorBalance * BigInt(1_000_000) / supplyResult) / 10_000 : null;
    const creatorSells = creator ? await db.select().from(schema.chainSwaps).where(and(eq(schema.chainSwaps.walletAddress, creator), eq(schema.chainSwaps.tokenAddress, address), eq(schema.chainSwaps.side, 'SELL'), gte(schema.chainSwaps.timestamp, new Date(Date.now() - 3_600_000)))) : [];
    const creatorSellUsd = creatorSells.length && creatorSells.every(s => s.usdValue != null) ? creatorSells.reduce((s, t) => s + t.usdValue!, 0) : null;
    const evidence = { verifiedSource: source?.is_verified ?? null, proxy: source ? Boolean(source.proxy_type || source.implementations?.length) : null, owner: ownerResult?.toLowerCase() ?? null,
      mint: capability(/mint/), blacklist: capability(/blacklist|blocklist|denylist/), pause: capability(/pause|tradingenabled|enabletrading/), top10: concentration.top10, creatorPercent, liquidityUsd: markets[0]?.liquidityUsd ?? null, creatorSellUsd, sellSimulation: 'UNKNOWN' as const };
    const risk = classifyRisk(evidence), now = new Date();
    const details = { ...risk, evidence, creator, holders: concentration, exclusions: [...excluded], holderPageComplete: holderResult.data ? !holderResult.data.next_page_params : false,
      limitations: ['Holder percentages use the returned explorer sample and current total supply; supply can change between observations.', 'Known pools and burn addresses are excluded from ranked holders; percentages use total supply.', 'Ownership renunciation does not remove other roles or proxy permissions.', 'No generic sell test is reported as a pass; trading simulates the actual wallet request.'],
      provenance: { source: 'Blockscout + chain RPC + Analyst indexed swaps', period: 'current state; creator sells 1h', calculatedAt: now.toISOString(), completeness: 'partial', holderObservedAt: holderResult.observedAt, contractObservedAt: contract.observedAt } };
    await db.insert(schema.riskAssessments).values({ id: `${address}:${now.getTime()}`, token: address, timestamp: now, overallRisk: risk.level, score: risk.score, sellSimulation: 'UNKNOWN', ownerPermissions: { owner: evidence.owner, proxy: evidence.proxy }, mintPermissions: evidence.mint, blacklistPossible: evidence.blacklist, pausePossible: evidence.pause, holderConcentration: evidence.top10, creatorHoldings: creatorPercent, liquidityRisk: evidence.liquidityUsd == null ? 'UNKNOWN' : evidence.liquidityUsd < 5000 ? 'THIN' : 'OBSERVED', suspiciousCreatorActivity: { sellUsd1h: creatorSellUsd, transactionHashes: creatorSells.slice(0, 20).map(s => s.txHash) }, details });
    return { token: address, ...details };
  });
}
