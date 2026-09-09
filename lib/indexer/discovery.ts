import 'server-only';
import { eq } from 'drizzle-orm';
import { zeroAddress, type Address } from 'viem';
import { getDb, schema } from '@/lib/db';
import { v2Config } from '@/lib/v2/config';
import { factoryAbi } from './contracts';
import { chainClient, verifyPool } from './rpc';

/** Sweep stored tokens for existing, factory-verified V3 markets. No symbol-based trust. */
export async function discoverExistingPools(limit = 25) {
  const config = v2Config();
  if (!config.UNISWAP_FACTORY_ADDRESS || !config.WRAPPED_NATIVE_ADDRESS) return 0;
  const db = await getDb(), client = chainClient();
  const [tokens, state, registered] = await Promise.all([
    db.select({ address: schema.tokens.address }).from(schema.tokens).orderBy(schema.tokens.address),
    db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'v2:pool-discovery')).limit(1),
    db.select({ address: schema.liquidityPools.address }).from(schema.liquidityPools),
  ]);
  if (!tokens.length) return 0;
  const known = new Set(registered.map(p => p.address));
  const offset = Number((state[0]?.value as { offset?: number } | undefined)?.offset ?? 0) % tokens.length;
  const batch = [...tokens.slice(offset), ...tokens.slice(0, offset)].slice(0, Math.min(limit, 250));
  let count = 0;
  for (const token of batch) {
    if (token.address === config.WRAPPED_NATIVE_ADDRESS) continue;
    const pools = await Promise.all([100, 500, 3000, 10000].map(fee => client.readContract({ address: config.UNISWAP_FACTORY_ADDRESS!, abi: factoryAbi, functionName: 'getPool', args: [token.address as Address, config.WRAPPED_NATIVE_ADDRESS!, fee] })));
    for (const pool of pools) {
      const address = pool.toLowerCase() as Address;
      if (address === zeroAddress || known.has(address)) continue;
      await verifyPool(client, address, 'uniswap-v3');
      known.add(address); count++;
    }
  }
  const value = { offset: offset + batch.length, total: tokens.length, lastDiscovered: count, observedAt: new Date().toISOString() };
  await db.insert(schema.appMeta).values({ key: 'v2:pool-discovery', value }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt: new Date() } });
  return count;
}
