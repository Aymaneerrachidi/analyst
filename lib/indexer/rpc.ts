import "server-only";
import { createPublicClient, http, erc20Abi, formatUnits, keccak256, zeroAddress, type Address } from "viem";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { robinhood } from "@/lib/trading/shared";
import { v2Config } from "@/lib/v2/config";
import { cleanSymbol, assetCategory } from "@/lib/presentation";
import { factoryAbi, poolAbi, ponsCurveAbi, ponsV2FactoryAbi } from "./contracts";
import { logEvent } from '@/lib/v2/log';

export function chainClient() {
  const config = v2Config();
  return createPublicClient({ chain: robinhood, transport: http(config.ALCHEMY_RPC_URL || robinhood.rpcUrls.default.http[0], { batch: { batchSize: 10, wait: 20 }, timeout: 15_000, retryCount: 2,
    onFetchResponse: async response => {
      if (response.status !== 429) return;
      const body = (await response.clone().text()).toLowerCase();
      const reason = body.includes('compute') || body.includes('throughput') ? 'compute_capacity' : body.includes('batch') ? 'batch_limit' : 'request_rate';
      logEvent('RPC', 'rate_limited', { reason });
    },
  }) });
}
export type ChainClient = ReturnType<typeof chainClient>;

export async function tokenMetadata(client: ChainClient, address: Address) {
  if (address === zeroAddress) return { address, symbol: "ETH", name: "Ether", decimals: 18 };
  const db = await getDb();
  const [known] = await db.select({ profile: schema.tokenProfiles, token: schema.tokens }).from(schema.tokenProfiles).innerJoin(schema.tokens, eq(schema.tokens.address, schema.tokenProfiles.address)).where(eq(schema.tokenProfiles.address, address)).limit(1);
  if (known?.profile.decimals != null) return { address, symbol: cleanSymbol(known.token.symbol), name: known.token.name, decimals: known.profile.decimals };
  const [decimals, symbol, name] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => "Unknown"),
    client.readContract({ address, abi: erc20Abi, functionName: "name" }).catch(() => "Unlabeled token"),
  ]);
  // Index every ERC-20 uint8 precision exactly as decimal text. The execution
  // adapter separately bounds supported input precision; a token cannot stall ingestion.
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Invalid token precision");
  const normalized = cleanSymbol(symbol).slice(0, 64);
  await db.insert(schema.tokens).values({ address, symbol: normalized, name: name.slice(0, 160) }).onConflictDoNothing();
  await db.insert(schema.tokenProfiles).values({ address, decimals, assetType: assetCategory(normalized).toUpperCase(), metadata: { source: "RPC", observedAt: new Date().toISOString() } })
    .onConflictDoUpdate({ target: schema.tokenProfiles.address, set: { decimals } });
  return { address, symbol: normalized, name, decimals };
}

/** Factory membership is verified on chain, not inferred from a token symbol or API label. */
export async function verifyPool(client: ChainClient, address: Address, kind: "uniswap-v2" | "uniswap-v3" | "pons-curve") {
  const config = v2Config();
  const factory = await client.readContract({ address, abi: poolAbi, functionName: "factory" });
  const allowed = kind === "pons-curve" ? config.PONS_FACTORY_ADDRESS : config.UNISWAP_FACTORY_ADDRESS;
  if (!allowed || factory.toLowerCase() !== allowed) throw new Error("Pool factory is not configured or verified");
  let token0: Address, token1: Address, fee: number | null = null;
  if (kind === "pons-curve") {
    [token0, token1] = await Promise.all([client.readContract({ address, abi: ponsCurveAbi, functionName: "token" }), client.readContract({ address, abi: ponsCurveAbi, functionName: "pairToken" })]);
    const launch = await client.readContract({ address: factory, abi: ponsV2FactoryAbi, functionName: "getLaunchedToken", args: [token0] });
    if (!launch.exists || launch.curve.toLowerCase() !== address) throw new Error("Curve is not registered by the factory");
  } else {
    [token0, token1] = await Promise.all([client.readContract({ address, abi: poolAbi, functionName: "token0" }), client.readContract({ address, abi: poolAbi, functionName: "token1" })]);
    if (kind === "uniswap-v3") fee = await client.readContract({ address, abi: poolAbi, functionName: "fee" });
    const registered = kind === "uniswap-v3" ? await client.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [token0, token1, fee!] }) : await client.readContract({ address: factory, abi: factoryAbi, functionName: "getPair", args: [token0, token1] });
    if (registered.toLowerCase() !== address) throw new Error("Pool is not registered by the factory");
  }
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error("Pool has no bytecode");
  await Promise.all([tokenMetadata(client, token0.toLowerCase() as Address), tokenMetadata(client, token1.toLowerCase() as Address)]);
  const pool = { address, chainId: 4663, token0: token0.toLowerCase(), token1: token1.toLowerCase(), dex: kind === "pons-curve" ? "Pons" : "Uniswap", kind, fee, factory: factory.toLowerCase(), verifiedAt: new Date(), codeHash: keccak256(code), active: true };
  const db = await getDb();
  await db.insert(schema.liquidityPools).values(pool).onConflictDoUpdate({ target: schema.liquidityPools.address, set: pool });
  return pool;
}

export function decimalAmount(raw: bigint, decimals: number) { return formatUnits(raw, decimals); }
