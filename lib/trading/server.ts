import "server-only";
import { createPublicClient, erc20Abi, http, zeroAddress, type Address } from "viem";
import { z } from "zod";
import { ALLOWANCE_HOLDER, NATIVE, SETTLER_REGISTRY, addressSchema, registryAbi, robinhood, sameAddress, unitsExact, validateExecution, type TradeAssets, type TradeInput, type TradeQuote } from "./shared";

const rpc = createPublicClient({ chain: robinhood, transport: http(process.env.ROBINHOOD_RPC_URL || robinhood.rpcUrls.default.http[0], { timeout: 12_000, retryCount: 1 }) });
const uint = z.string().regex(/^\d{1,78}$/).refine((v) => BigInt(v) < BigInt(2) ** BigInt(256));
const positive = uint.refine((v) => BigInt(v) > BigInt(0));
const metadata = new Map<string, { symbol: string; decimals: number; until: number }>();
export class TradingError extends Error { constructor(message: string, public status = 502) { super(message); } }
export const executionEnabled = () => Boolean(process.env.ZERO_EX_API_KEY?.trim());

export async function getAssets(token: Address, account?: Address): Promise<TradeAssets> {
  if (await rpc.getChainId() !== robinhood.id) throw new TradingError("Trading network is unavailable.");
  let meta = metadata.get(token);
  if (!meta || meta.until < Date.now()) {
    const [symbol, decimals] = await Promise.all([
      rpc.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      rpc.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    ]);
    if (decimals > 36 || !symbol || symbol.length > 80) throw new TradingError("This token format is not supported.", 422);
    meta = { symbol, decimals, until: Date.now() + 300_000 };
    if (metadata.size > 2000) metadata.clear();
    metadata.set(token, meta);
  }
  const balances = account ? await Promise.all([
    rpc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] }), rpc.getBalance({ address: account }),
  ]) : undefined;
  return { token: { address: token, symbol: meta.symbol, decimals: meta.decimals, balance: balances?.[0].toString() }, native: { address: NATIVE, symbol: "ETH", decimals: 18, balance: balances?.[1].toString() }, executionEnabled: executionEnabled() };
}

async function providerJson(url: string, init: RequestInit) {
  let r: Response;
  try { r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) }); }
  catch { throw new TradingError("The quote provider is taking too long. Try again.", 504); }
  if (!r.ok) {
    const detail = await r.text();
    if (/TOKEN_NOT_AUTHORIZED_FOR_TRADE|TOKEN_RESTRICTED|JURISDICTION/i.test(detail)) throw new TradingError("This token requires additional trading access from the provider. It is not available through this app's current account.", 403);
    if (r.status === 401 || r.status === 403) throw new TradingError("Trading access is unavailable for this request.", 503);
    if (r.status === 429) throw new TradingError("The quote provider is busy. Wait a moment and refresh.", 429);
    if ([400, 404, 422].includes(r.status)) throw new TradingError("No supported route is available for this token and amount. Try a different amount.", 422);
    throw new TradingError("The quote provider is unavailable. Try again shortly.");
  }
  return r.json();
}

export async function getQuote(input: TradeInput): Promise<TradeQuote> {
  if (input.mode === "review" && !executionEnabled()) throw new TradingError("In-app trading is not enabled yet. Live quotes are available through Umbra.", 503);
  if (input.mode === "review" && !input.account) throw new TradingError("Connect a wallet to review this trade.", 400);
  const assets = await getAssets(input.token);
  const selling = input.side === "buy" ? assets.native : assets.token;
  const buying = input.side === "buy" ? assets.token : assets.native;
  let sellAmount: string;
  try { sellAmount = unitsExact(input.amount, selling.decimals).toString(); }
  catch (e) { throw new TradingError(e instanceof Error ? e.message : "Invalid amount.", 400); }
  const base = { sellToken: selling.address, buyToken: buying.address, sellAmount, sellDecimals: selling.decimals, buyDecimals: buying.decimals, account: input.account };
  if (!executionEnabled()) {
    const raw = await providerJson("https://www.umbra.finance/api/rh/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenIn: input.side === "buy" ? "ETH" : input.token, tokenOut: input.side === "buy" ? input.token : "ETH", amount: sellAmount }) });
    const q = z.object({ tokenIn: z.string(), tokenOut: z.string(), amountIn: positive, netOut: positive, fee: uint, feeBps: z.number().min(0).max(100), inDecimals: z.number().int(), outDecimals: z.number().int(), legs: z.array(z.object({ venues: z.array(z.string().max(100)) })).min(1) }).parse(raw);
    const native = (s: string) => s === "ETH" || sameAddress(s, zeroAddress) ? NATIVE : s;
    if (!sameAddress(native(q.tokenIn), selling.address) || !sameAddress(native(q.tokenOut), buying.address) || q.amountIn !== sellAmount || q.inDecimals !== selling.decimals || q.outDecimals !== buying.decimals) throw new TradingError("The quote did not match the requested trade.");
    return { ...base, provider: "Umbra", executable: false, buyAmount: q.netOut, minBuyAmount: (BigInt(q.netOut) * BigInt(10000 - input.slippageBps) / BigInt(10000)).toString(), expiresAt: Date.now() + 15_000, routes: [...new Set(q.legs.flatMap((l) => l.venues))], fees: [{ token: buying.address, amount: q.fee, label: `Umbra fee (${q.feeBps / 100}%)` }] };
  }
  // Ask for a floor 1 bp tighter than the user's cap. The provider rounds its
  // minimum with floating-point arithmetic; keep our exact integer cap intact.
  const p = new URLSearchParams({ chainId: String(robinhood.id), sellToken: selling.address, buyToken: buying.address, sellAmount, slippageBps: String(input.slippageBps - 1), ...(input.account ? { taker: input.account, recipient: input.account } : {}) });
  const raw = await providerJson(`https://api.0x.org/swap/allowance-holder/${input.mode === "review" ? "quote" : "price"}?${p}`, { headers: { "0x-api-key": process.env.ZERO_EX_API_KEY!, "0x-version": "v2" } });
  if (raw.liquidityAvailable !== true) throw new TradingError("No supported liquidity is available for this trade.", 422);
  const fee = z.object({ amount: uint, token: addressSchema }).nullable();
  const q = z.object({ sellToken: addressSchema, buyToken: addressSchema, sellAmount: positive, buyAmount: positive, minBuyAmount: positive,
    route: z.object({ fills: z.array(z.object({ source: z.string().max(100) })).min(1) }),
    fees: z.object({ zeroExFee: fee.optional(), integratorFee: fee.optional(), gasFee: fee.optional() }).optional(),
    issues: z.object({ allowance: z.object({ spender: addressSchema }).nullable().optional() }).optional(),
    transaction: z.object({ to: addressSchema, data: z.string().max(200_000).regex(/^0x(?:[a-fA-F0-9]{2}){4,}$/), value: uint }).optional(),
  }).parse(raw);
  if (!sameAddress(q.sellToken, selling.address) || !sameAddress(q.buyToken, buying.address) || q.sellAmount !== sellAmount || BigInt(q.minBuyAmount) < BigInt(q.buyAmount) * BigInt(10000 - input.slippageBps) / BigInt(10000)) throw new TradingError("The quote did not match the requested trade or slippage.");
  if (q.issues?.allowance && !sameAddress(q.issues.allowance.spender, ALLOWANCE_HOLDER)) throw new TradingError("The provider returned an unsupported approval contract.");
  const quote: TradeQuote = { ...base, provider: "0x", executable: input.mode === "review", buyAmount: q.buyAmount, minBuyAmount: q.minBuyAmount, expiresAt: Date.now() + 60_000, routes: [...new Set(q.route.fills.map((f) => f.source))], fees: Object.entries(q.fees ?? {}).flatMap(([name, f]) => f && BigInt(f.amount) > BigInt(0) ? [{ token: f.token, amount: f.amount, label: name === "zeroExFee" ? "0x fee" : name === "gasFee" ? "Provider gas fee" : "Integrator fee" }] : []),
    transaction: q.transaction ? { ...q.transaction, data: q.transaction.data as `0x${string}` } : undefined, spender: input.side === "sell" ? ALLOWANCE_HOLDER : undefined };
  if (quote.executable) {
    // A paused registry must fail, even if prev() still returns an old deployment.
    const current = await rpc.readContract({ address: SETTLER_REGISTRY, abi: registryAbi, functionName: "ownerOf", args: [BigInt(2)] });
    const previous = await rpc.readContract({ address: SETTLER_REGISTRY, abi: registryAbi, functionName: "prev", args: [BigInt(2)] });
    validateExecution(quote, input.account!, [current, previous]);
  }
  return quote;
}
