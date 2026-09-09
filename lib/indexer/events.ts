import { decodeEventLog, parseAbi, type Hex } from "viem";
import { ponsCurveAbi } from "./contracts";

export const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
export const v2SwapAbi = parseAbi(["event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)"]);
export const v3SwapAbi = parseAbi(["event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"]);
export const v2FactoryAbi = parseAbi(["event PairCreated(address indexed token0, address indexed token1, address pair, uint256 allPairsLength)"]);
export const v3FactoryAbi = parseAbi(["event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"]);
export const ponsV1FactoryAbi = parseAbi(['event TokenLaunched(address indexed token,address indexed deployer,address indexed dexFactory,address pairToken,address pool,uint256 dexId,uint256 launchConfigId,uint256 positionId,uint256 restrictionsEndBlock,uint256 initialBuyAmount)']);

export type RawLog = { address: string; topics: readonly Hex[]; data: Hex; logIndex: number; transactionHash: Hex; blockHash: Hex; blockNumber: bigint };
export type Pool = { address: string; token0: string; token1: string; kind: string; dex: string };
export type ParsedSwap = { tokenAddress: string; quoteAddress: string; side: "BUY" | "SELL"; amountTokenRaw: bigint; amountQuoteRaw: bigint; wallet?: string; recipient?: string };

/** Decode pool deltas, not router calldata. Unsupported or ambiguous swaps stay raw. */
export function parseSwap(log: RawLog, pool: Pool, quoteTokens: readonly string[]): ParsedSwap | null {
  try {
    if (log.address.toLowerCase() !== pool.address.toLowerCase()) return null;
    if (pool.kind === "pons-curve") {
      const decoded = decodeEventLog({ abi: ponsCurveAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
      if (decoded.eventName === "CurveBuy") return { tokenAddress: pool.token0, quoteAddress: pool.token1, side: "BUY", amountTokenRaw: decoded.args.tokensOut, amountQuoteRaw: decoded.args.quoteIn, wallet: decoded.args.buyer.toLowerCase(), recipient: decoded.args.recipient.toLowerCase() };
      if (decoded.eventName === "CurveSell") return { tokenAddress: pool.token0, quoteAddress: pool.token1, side: "SELL", amountTokenRaw: decoded.args.tokensIn, amountQuoteRaw: decoded.args.quoteOut, wallet: decoded.args.seller.toLowerCase(), recipient: decoded.args.recipient.toLowerCase() };
      return null;
    }
    let amount0: bigint, amount1: bigint;
    if (pool.kind === "uniswap-v2") {
      const { args } = decodeEventLog({ abi: v2SwapAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
      amount0 = args.amount0In - args.amount0Out; amount1 = args.amount1In - args.amount1Out;
    } else if (pool.kind === "uniswap-v3") {
      const { args } = decodeEventLog({ abi: v3SwapAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
      amount0 = args.amount0; amount1 = args.amount1;
    } else return null;
    if (amount0 === BigInt(0) || amount1 === BigInt(0) || (amount0 > BigInt(0)) === (amount1 > BigInt(0))) return null;
    const quotes = new Set(quoteTokens.map(t => t.toLowerCase()));
    const quote0 = quotes.has(pool.token0.toLowerCase()), quote1 = quotes.has(pool.token1.toLowerCase());
    if (quote0 === quote1) return null;
    const tokenDelta = quote0 ? amount1 : amount0, quoteDelta = quote0 ? amount0 : amount1;
    return { tokenAddress: (quote0 ? pool.token1 : pool.token0).toLowerCase(), quoteAddress: (quote0 ? pool.token0 : pool.token1).toLowerCase(), side: tokenDelta < BigInt(0) ? "BUY" : "SELL", amountTokenRaw: tokenDelta < BigInt(0) ? -tokenDelta : tokenDelta, amountQuoteRaw: quoteDelta < BigInt(0) ? -quoteDelta : quoteDelta };
  } catch { return null; }
}

export function parseTransfer(log: RawLog) {
  try {
    const { args } = decodeEventLog({ abi: transferAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
    return { from: args.from.toLowerCase(), to: args.to.toLowerCase(), amountRaw: args.value.toString() };
  } catch { return null; }
}

export function rawEventId(log: RawLog, chainId = 4663) { return `${chainId}:${log.blockHash}:${log.transactionHash}:${log.logIndex}`; }
export function canonicalEventId(log: RawLog, chainId = 4663) { return `${chainId}:${log.transactionHash}:${log.logIndex}`; }
