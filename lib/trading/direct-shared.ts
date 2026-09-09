import { decodeFunctionData, encodeFunctionData, keccak256, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from 'viem';
import { NATIVE, sameAddress, type TradeQuote } from './shared';
import { ponsCurveAbi, ponsV2FactoryAbi, factoryAbi } from '@/lib/indexer/contracts';
import { v4Calldata, universalRouterAbi } from './v4-shared';
export const router02Abi = parseAbi([
  'function factory() view returns (address)', 'function WETH9() view returns (address)',
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)',
  'function unwrapWETH9(uint256 amountMinimum,address recipient) payable', 'function refundETH() payable',
]);
export const quoterV2Abi = parseAbi(['function factory() view returns (address)', 'function WETH9() view returns (address)', 'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
export function curveEstimate(input: { buy: boolean; amount: bigint; quoteReserve: bigint; tokenReserve: bigint; feeBps: bigint; taxBps: bigint; sellable: bigint; realQuote: bigint }) {
  const { buy, amount, quoteReserve, tokenReserve, feeBps, taxBps, sellable, realQuote } = input, bps = BigInt(10000);
  if (amount <= BigInt(0) || quoteReserve <= BigInt(0) || tokenReserve <= BigInt(0) || sellable <= BigInt(0) || feeBps + taxBps >= bps) throw new Error('Curve liquidity is unavailable.');
  let spent = amount, fee: bigint, tax: bigint, out: bigint;
  if (buy) {
    fee = spent * feeBps / bps; tax = spent * taxBps / bps;
    const net = spent - fee - tax; out = net * tokenReserve / (quoteReserve + net);
    if (out > sellable) { out = sellable; const netRequired = quoteReserve * out / (tokenReserve - out) + BigInt(1); spent = (netRequired * bps + (bps - feeBps - taxBps) - BigInt(1)) / (bps - feeBps - taxBps); if (spent > amount) spent = amount; fee = spent * feeBps / bps; tax = spent * taxBps / bps; }
  } else { const gross = amount * quoteReserve / (tokenReserve + amount); if (gross > realQuote) throw new Error('Insufficient real quote liquidity.'); fee = gross * feeBps / bps; tax = gross * taxBps / bps; out = gross - fee - tax; }
  if (out <= BigInt(0)) throw new Error('Trade output rounds to zero.');
  const spotOutput = buy ? Number(spent) * Number(tokenReserve) / Number(quoteReserve) : Number(amount) * Number(quoteReserve) / Number(tokenReserve);
  return { out, spent, fee, tax, impact: Number.isFinite(spotOutput) && spotOutput > 0 ? Math.max(0, (1 - Number(out) / spotOutput) * 100) : null };
}
export function directCalldata(q: TradeQuote, account: Address): Hex {
  const direct = q.direct; if (!direct || !q.transaction) throw new Error('Missing verified route.');
  const buy = sameAddress(q.sellToken, NATIVE);
  if (direct.kind === 'uniswap-v4') return v4Calldata(q);
  if (direct.kind === 'pons-curve') return encodeFunctionData({ abi: ponsCurveAbi, functionName: buy ? 'buy' : 'sell', args: [BigInt(q.sellAmount), BigInt(q.minBuyAmount), account] });
  if (!direct.wrappedNative || direct.fee == null) throw new Error('Incomplete V3 route.');
  const swap = encodeFunctionData({ abi: router02Abi, functionName: 'exactInputSingle', args: [{ tokenIn: buy ? direct.wrappedNative : q.sellToken, tokenOut: buy ? q.buyToken : direct.wrappedNative, fee: direct.fee, recipient: buy ? account : q.transaction.to, amountIn: BigInt(q.sellAmount), amountOutMinimum: BigInt(q.minBuyAmount), sqrtPriceLimitX96: BigInt(0) }] });
  const cleanup = buy ? encodeFunctionData({ abi: router02Abi, functionName: 'refundETH' }) : encodeFunctionData({ abi: router02Abi, functionName: 'unwrapWETH9', args: [BigInt(q.minBuyAmount), account] });
  return encodeFunctionData({ abi: router02Abi, functionName: 'multicall', args: [BigInt(Math.floor(q.expiresAt / 1000)), [swap, cleanup]] });
}
export function validateDirectExecution(q: TradeQuote, account: Address, now = Date.now()) {
  const tx = q.transaction, direct = q.direct, buy = sameAddress(q.sellToken, NATIVE);
  if (!q.executable || !tx || !direct || !q.account || !sameAddress(q.account, account) || !['Pons curve', 'Uniswap V3', 'Uniswap V4'].includes(q.provider)) throw new Error('No executable direct quote for this wallet.');
  if ({ 'pons-curve': 'Pons curve', 'uniswap-v3': 'Uniswap V3', 'uniswap-v4': 'Uniswap V4' }[direct.kind] !== q.provider) throw new Error('Route provider does not match its contract adapter.');
  if (q.expiresAt <= now || q.expiresAt > now + 65_000) throw new Error('Quote expired. Refresh to continue.');
  if (BigInt(q.sellAmount) <= BigInt(0) || BigInt(q.minBuyAmount) <= BigInt(0) || BigInt(q.minBuyAmount) > BigInt(q.buyAmount)) throw new Error('Invalid trade amounts.');
  if (BigInt(tx.value) !== (buy ? BigInt(q.sellAmount) : BigInt(0))) throw new Error('Transaction value does not match the trade.');
  if (!buy && (!q.spender || !sameAddress(q.spender, direct.kind === 'uniswap-v4' ? direct.v4?.permit2 ?? zeroAddress : tx.to))) throw new Error('Approval spender does not match the verified route.');
  if (direct.kind === 'pons-curve' && !sameAddress(tx.to, direct.pool)) throw new Error('Curve target mismatch.');
  if (tx.data.toLowerCase() !== directCalldata(q, account).toLowerCase()) throw new Error('Recipient, amount, token, deadline or route calldata does not match.');
  // Decode as a second structural check; no arbitrary nested methods are accepted.
  if (direct.kind === 'uniswap-v3') { const call = decodeFunctionData({ abi: router02Abi, data: tx.data }); if (call.functionName !== 'multicall') throw new Error('Unsupported router call.'); }
}

export async function verifyDirectRoute(client: Pick<PublicClient, 'getCode' | 'readContract'>, q: TradeQuote) {
  const d = q.direct, tx = q.transaction; if (!d || !tx) throw new Error('Verified direct route missing.');
  const code = await client.getCode({ address: tx.to });
  if (!code || code === '0x' || !sameAddress(keccak256(code), d.codeHash)) throw new Error('Route bytecode changed. Refresh the quote.');
  const token = sameAddress(q.sellToken, NATIVE) ? q.buyToken : q.sellToken;
  if (d.kind === 'pons-curve') {
    const [launch, curveToken, pair, graduated] = await Promise.all([client.readContract({ address: d.factory, abi: ponsV2FactoryAbi, functionName: 'getLaunchedToken', args: [token] }), client.readContract({ address: tx.to, abi: ponsCurveAbi, functionName: 'token' }), client.readContract({ address: tx.to, abi: ponsCurveAbi, functionName: 'pairToken' }), client.readContract({ address: tx.to, abi: ponsCurveAbi, functionName: 'graduated' })]);
    if (!launch.exists || !sameAddress(launch.curve, tx.to) || !sameAddress(curveToken, token) || pair !== zeroAddress || graduated) throw new Error('The curve state or registered token changed.');
  } else if (d.kind === 'uniswap-v4') {
    const manager = await client.readContract({ address: tx.to, abi: universalRouterAbi, functionName: 'poolManager' });
    if (!sameAddress(manager, d.factory)) throw new Error('V4 manager does not match the verified route.');
    if (d.v4?.permit2) { const permitCode = await client.getCode({ address: d.v4.permit2 }); if (!permitCode || !d.v4.permit2CodeHash || keccak256(permitCode).toLowerCase() !== d.v4.permit2CodeHash.toLowerCase()) throw new Error('Permit2 verification failed.'); }
  } else {
    const [factory, wrapped, pool] = await Promise.all([client.readContract({ address: tx.to, abi: router02Abi, functionName: 'factory' }), client.readContract({ address: tx.to, abi: router02Abi, functionName: 'WETH9' }), client.readContract({ address: d.factory, abi: factoryAbi, functionName: 'getPool', args: [token, d.wrappedNative!, d.fee!] })]);
    if (!sameAddress(factory, d.factory) || !sameAddress(wrapped, d.wrappedNative!) || !sameAddress(pool, d.pool)) throw new Error('The router and pool configuration do not match.');
  }
}
