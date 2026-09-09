import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, zeroAddress, type Hex } from 'viem';
import type { TradeQuote } from './shared';
export const universalRouterAbi = parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable', 'function poolManager() view returns (address)']);
export const permit2Abi = parseAbi(['function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)', 'function approve(address token,address spender,uint160 amount,uint48 expiration)']);
export const v4QuoterAbi = parseAbi(['function poolManager() view returns (address)', 'function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)']);
export const ponsV4GettersAbi = parseAbi(['function poolManager() view returns (address)', 'function memeHook() view returns (address)']);
export function v4Calldata(q: TradeQuote): Hex {
  const v4 = q.direct?.v4; if (!v4) throw new Error('Missing V4 pool key.');
  const key = v4.poolKey, nativeBuy = q.sellToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const currencyIn = nativeBuy ? zeroAddress : q.sellToken, currencyOut = nativeBuy ? q.buyToken : zeroAddress;
  if (BigInt(q.sellAmount) >= BigInt(2) ** BigInt(128) || BigInt(q.minBuyAmount) >= BigInt(2) ** BigInt(128)) throw new Error('Amount exceeds the V4 router limit.');
  const zeroForOne = key.currency0.toLowerCase() === currencyIn.toLowerCase();
  if ((zeroForOne ? key.currency1 : key.currency0).toLowerCase() !== currencyOut.toLowerCase()) throw new Error('V4 pool currencies do not match.');
  const classic = parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)');
  const modern = parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)');
  const params = { poolKey: key, zeroForOne, amountIn: BigInt(q.sellAmount), amountOutMinimum: BigInt(q.minBuyAmount), hookData: '0x' as Hex };
  const swap = v4.routerVersion === 'hop-price' ? encodeAbiParameters(modern, [{ ...params, minHopPriceX36: BigInt(0) }]) : encodeAbiParameters(classic, [params]);
  const settle = encodeAbiParameters(parseAbiParameters('address currency,uint256 maxAmount'), [currencyIn, BigInt(q.sellAmount)]);
  const take = encodeAbiParameters(parseAbiParameters('address currency,uint256 minAmount'), [currencyOut, BigInt(q.minBuyAmount)]);
  // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL. TAKE_ALL pays the original msgSender.
  const input = encodeAbiParameters(parseAbiParameters('bytes actions,bytes[] params'), ['0x060c0f', [swap, settle, take]]);
  // No allow-revert flag; the entire swap must succeed. Deadline is enforced on chain.
  return encodeFunctionData({ abi: universalRouterAbi, functionName: 'execute', args: ['0x10', [input], BigInt(Math.floor(q.expiresAt / 1000))] });
}
