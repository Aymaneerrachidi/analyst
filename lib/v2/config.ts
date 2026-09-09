import { isAddress, type Address } from "viem";
import { z } from "zod";

const address = z.string().refine(v => isAddress(v, { strict: false }) && !/^0x0{40}$/i.test(v), "Invalid configured contract").transform(v => v.toLowerCase() as Address);
const optionalUrl = z.preprocess(v => v === "" ? undefined : v, z.string().url().optional());
const optionalAddress = z.preprocess(v => v === "" ? undefined : v, address.optional());
const sourceSchema = z.object({
  ALCHEMY_RPC_URL: optionalUrl, ALCHEMY_WS_URL: optionalUrl,
  INDEXER_START_BLOCK: z.preprocess(v => v === "" || v == null ? undefined : v, z.coerce.number().int().nonnegative().safe().optional()),
  INDEXER_CONFIRMATIONS: z.coerce.number().int().min(2).max(100).default(6),
  INDEXER_BATCH_BLOCKS: z.coerce.number().int().min(1).max(500).default(50),
  INDEXER_POLL_MS: z.coerce.number().int().min(1000).max(60_000).default(4000),
  INDEXER_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  INDEXER_URL: optionalUrl, INDEXER_SECRET: z.string().optional(),
  BASE44_AGENT_URL: optionalUrl, BASE44_AGENT_KEY: z.string().optional(), BASE44_AGENT_ID: z.string().optional(),
  BLOCKSCOUT_API_URL: z.string().url().default("https://robinhoodchain.blockscout.com/api/v2"),
  DEXSCREENER_BASE_URL: z.string().url().default("https://api.dexscreener.com"),
  STOCK_TOKEN_API_URL: optionalUrl,
  PONS_FACTORY_ADDRESS: optionalAddress, PONS_ROUTER_ADDRESS: optionalAddress,
  PONS_V1_FACTORY_ADDRESS: optionalAddress,
  PONS_FACTORY_CODE_HASH: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  UNISWAP_ROUTER_CODE_HASH: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  UNISWAP_QUOTER_CODE_HASH: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  UNISWAP_V4_POOL_MANAGER: optionalAddress, UNISWAP_V4_ROUTER: optionalAddress, UNISWAP_V4_QUOTER: optionalAddress,
  UNISWAP_V4_ROUTER_CODE_HASH: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  UNISWAP_V4_QUOTER_CODE_HASH: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  UNISWAP_V4_ROUTER_ABI_VERSION: z.enum(['classic', 'hop-price']).default('classic'),
  PERMIT2_ADDRESS: optionalAddress, PERMIT2_CODE_HASH: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  UNISWAP_FACTORY_ADDRESS: optionalAddress, UNISWAP_ROUTER_ADDRESS: optionalAddress, UNISWAP_QUOTER_ADDRESS: optionalAddress,
  WRAPPED_NATIVE_ADDRESS: optionalAddress,
  // Explicit allowlisted quote tokens; symbols alone never imply USD parity.
  USD_QUOTE_ADDRESSES: z.string().default(""),
  VERIFIED_POOL_ADDRESSES: z.string().default(""),
});

export function v2Config(source: Record<string, string | undefined> = process.env) {
  const result = sourceSchema.safeParse({ ...source, INDEXER_PORT: source.PORT || source.INDEXER_PORT });
  if (!result.success) throw new Error(`Invalid configuration: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  return { ...result.data,
    usdQuotes: result.data.USD_QUOTE_ADDRESSES.split(',').map(s => s.trim()).filter(Boolean).map(v => address.parse(v)),
    pools: result.data.VERIFIED_POOL_ADDRESSES.split(',').map(s => s.trim()).filter(Boolean).map(v => address.parse(v)),
  };
}
export const CHAIN_ID = 4663;
export const INDEXER_VERSION = 1;
