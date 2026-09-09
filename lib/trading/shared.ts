import { defineChain, isAddress, parseUnits, type Address, type Hex } from "viem";
import { z } from "zod";

export const robinhood = defineChain({
  id: 4663, name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});
export const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as Address;
export const addressSchema = z.string().refine((v) => isAddress(v, { strict: false }) && !/^0x0{40}$/i.test(v), "Invalid token or wallet address").transform((v) => v.toLowerCase() as Address);
export const tradeInputSchema = z.object({
  token: addressSchema.refine((v) => v !== NATIVE, "Select an ERC-20 token"),
  side: z.enum(["buy", "sell"]),
  amount: z.string().max(100).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Enter a positive decimal amount"),
  slippageBps: z.number().int().min(10).max(500),
  account: addressSchema.optional(),
  mode: z.enum(["preview", "review"]).default("preview"),
}).strict();
export type TradeInput = z.infer<typeof tradeInputSchema>;
export type TradeAsset = { address: Address; symbol: string; decimals: number; balance?: string };
export type TradeAssets = { token: TradeAsset; native: TradeAsset; executionEnabled: boolean };
export type TradeQuote = {
  provider: "Pons curve" | "Uniswap V3" | "Uniswap V4"; executable: boolean; account?: Address;
  sellToken: Address; buyToken: Address; sellAmount: string; buyAmount: string; minBuyAmount: string;
  sellDecimals: number; buyDecimals: number; expiresAt: number; routes: string[];
  fees: { token: Address; amount: string; label: string }[];
  transaction?: { to: Address; data: Hex; value: string };
  spender?: Address;
  direct?: { kind: 'pons-curve' | 'uniswap-v3' | 'uniswap-v4'; factory: Address; wrappedNative?: Address; fee?: number; pool: Address; codeHash: Hex; block: number; priceImpact: number | null; partialFill: boolean;
    v4?: { poolKey: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }; routerVersion: 'classic' | 'hop-price'; permit2?: Address; permit2CodeHash?: Hex } };
};
export function unitsExact(value: string, decimals: number): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || value.length > 100 || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Enter a valid amount.");
  if ((value.split(".")[1]?.length ?? 0) > decimals) throw new Error(`This token supports ${decimals} decimal places.`);
  const amount = parseUnits(value, decimals);
  if (amount <= BigInt(0) || amount >= BigInt(2) ** BigInt(256)) throw new Error("Amount is outside the supported range.");
  return amount;
}
export function sameAddress(a: string, b: string) { return a.toLowerCase() === b.toLowerCase(); }
