import { decodeFunctionData, defineChain, isAddress, parseAbi, parseUnits, zeroAddress, type Address, type Hex } from "viem";
import { z } from "zod";

export const robinhood = defineChain({
  id: 4663, name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});
export const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as Address;
export const ALLOWANCE_HOLDER = "0x0000000000001ff3684f28c67538d4d072c22734" as Address;
export const SETTLER_REGISTRY = "0x00000000000004533fe15556b1e086bb1a72ceae" as Address;
export const holderAbi = parseAbi(["function exec(address operator, address token, uint256 amount, address target, bytes data) payable returns (bytes)"]);
export const settlerAbi = parseAbi(["function execute((address recipient, address buyToken, uint256 minAmountOut) slippage, bytes[] actions, bytes32 affiliate) payable returns (bool)"]);
export const registryAbi = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)", "function prev(uint128 featureId) view returns (address)"]);
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
  provider: "0x" | "Umbra"; executable: boolean; account?: Address;
  sellToken: Address; buyToken: Address; sellAmount: string; buyAmount: string; minBuyAmount: string;
  sellDecimals: number; buyDecimals: number; expiresAt: number; routes: string[];
  fees: { token: Address; amount: string; label: string }[];
  transaction?: { to: Address; data: Hex; value: string };
  spender?: Address;
};
export function unitsExact(value: string, decimals: number): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || value.length > 100 || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Enter a valid amount.");
  if ((value.split(".")[1]?.length ?? 0) > decimals) throw new Error(`This token supports ${decimals} decimal places.`);
  const amount = parseUnits(value, decimals);
  if (amount <= BigInt(0) || amount >= BigInt(2) ** BigInt(256)) throw new Error("Amount is outside the supported range.");
  return amount;
}
export function sameAddress(a: string, b: string) { return a.toLowerCase() === b.toLowerCase(); }

/** Decode both execution layers. Never allow a provider response to pick an arbitrary spender or recipient. */
export function validateExecution(quote: TradeQuote, account: Address, settlers: Address[], now = Date.now()) {
  const tx = quote.transaction;
  if (quote.provider !== "0x" || !quote.executable || !tx || !quote.account || !sameAddress(quote.account, account)) throw new Error("No executable quote for this wallet.");
  if (quote.expiresAt <= now || quote.expiresAt > now + 65_000) throw new Error("Quote expired. Refresh to continue.");
  const nativeIn = sameAddress(quote.sellToken, NATIVE);
  if (BigInt(tx.value) !== (nativeIn ? BigInt(quote.sellAmount) : BigInt(0))) throw new Error("Transaction value does not match the trade.");
  if (BigInt(quote.minBuyAmount) <= BigInt(0) || BigInt(quote.minBuyAmount) > BigInt(quote.buyAmount)) throw new Error("Invalid minimum received.");
  if (quote.spender && !sameAddress(quote.spender, ALLOWANCE_HOLDER)) throw new Error("Unrecognized allowance spender.");
  let data = tx.data;
  let target = tx.to;
  if (sameAddress(tx.to, ALLOWANCE_HOLDER)) {
    const call = decodeFunctionData({ abi: holderAbi, data });
    const [operator, token, amount, destination, nested] = call.args;
    // AllowanceHolder represents native ETH with zero; the HTTP API uses 0xeeee.
    const inputMatches = sameAddress(token, quote.sellToken) || (nativeIn && sameAddress(token, zeroAddress));
    if (!sameAddress(operator, destination) || !inputMatches || amount !== BigInt(quote.sellAmount)) throw new Error("Allowance payload does not match the trade.");
    target = destination; data = nested;
  } else if (!nativeIn) throw new Error("Token swaps must use AllowanceHolder.");
  if (!settlers.some((s) => sameAddress(s, target))) throw new Error("Unrecognized or paused settlement contract.");
  const decoded = decodeFunctionData({ abi: settlerAbi, data });
  const [slippage, actions] = decoded.args;
  if (!sameAddress(slippage.recipient, account) || !sameAddress(slippage.buyToken, quote.buyToken) || slippage.minAmountOut !== BigInt(quote.minBuyAmount) || actions.length === 0) throw new Error("Swap recipient, token, or minimum received does not match.");
}

export function umbraLink(input: Pick<TradeInput, "token" | "side" | "amount">) {
  const p = new URLSearchParams({ pay: input.side === "buy" ? "ETH" : input.token, buy: input.side === "buy" ? input.token : "ETH", amt: input.amount });
  return `https://www.umbra.finance/robinhood?${p}`;
}
