import 'server-only';
import { erc20Abi, keccak256, zeroAddress, type Address, type Hex } from 'viem';
import { chainClient, tokenMetadata, verifyPool } from '@/lib/indexer/rpc';
import { factoryAbi, ponsCurveAbi, ponsV2FactoryAbi } from '@/lib/indexer/contracts';
import { v2Config } from '@/lib/v2/config';
import { NATIVE, sameAddress, unitsExact, type TradeAssets, type TradeInput, type TradeQuote } from './shared';
import { curveEstimate, directCalldata, quoterV2Abi, router02Abi, validateDirectExecution } from './direct-shared';
import { ponsV4Quote } from './v4-server';
export class TradingError extends Error { constructor(message: string, public status = 502) { super(message); } }
export const executionEnabled = () => { const c = v2Config(); return Boolean(c.PONS_FACTORY_ADDRESS && c.PONS_FACTORY_CODE_HASH || c.UNISWAP_FACTORY_ADDRESS && c.UNISWAP_ROUTER_ADDRESS && c.UNISWAP_QUOTER_ADDRESS && c.WRAPPED_NATIVE_ADDRESS && c.UNISWAP_ROUTER_CODE_HASH && c.UNISWAP_QUOTER_CODE_HASH); };
async function codePin(address: Address, expected: string | undefined) {
  if (!expected) throw new TradingError('This route needs a verified deployment code hash.', 503);
  const code = await chainClient().getCode({ address });
  if (!code || code === '0x' || keccak256(code).toLowerCase() !== expected.toLowerCase()) throw new TradingError('Contract deployment verification failed. Trading is disabled for this route.', 503);
}
export async function getAssets(token: Address, account?: Address): Promise<TradeAssets> {
  const rpc = chainClient(); if (await rpc.getChainId() !== 4663) throw new TradingError('Trading network is unavailable.');
  const meta = await tokenMetadata(rpc, token);
  const balances = account ? await Promise.all([rpc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account] }), rpc.getBalance({ address: account })]) : undefined;
  return { token: { address: token, symbol: meta.symbol, decimals: meta.decimals, balance: balances?.[0].toString() }, native: { address: NATIVE, symbol: 'ETH', decimals: 18, balance: balances?.[1].toString() }, executionEnabled: executionEnabled() };
}
export async function getQuote(input: TradeInput): Promise<TradeQuote> {
  if (!executionEnabled()) throw new TradingError('Direct trading needs verified Pons or Uniswap deployment configuration. No route has been enabled yet.', 503);
  if (input.mode === 'review' && !input.account) throw new TradingError('Connect your wallet to review a trade.', 400);
  const rpc = chainClient(), config = v2Config(), assets = await getAssets(input.token), buy = input.side === 'buy';
  const sell = buy ? assets.native : assets.token, receive = buy ? assets.token : assets.native;
  let amount: bigint; try { amount = unitsExact(input.amount, sell.decimals); } catch (e) { throw new TradingError(e instanceof Error ? e.message : 'Invalid amount.', 400); }
  const block = await rpc.getBlockNumber({ cacheTime: 0 });
  const base = { account: input.account, executable: input.mode === 'review', sellToken: sell.address, buyToken: receive.address, sellAmount: amount.toString(), sellDecimals: sell.decimals, buyDecimals: receive.decimals, expiresAt: Date.now() + 60_000 };
  if (config.PONS_FACTORY_ADDRESS && config.PONS_FACTORY_CODE_HASH) {
    await codePin(config.PONS_FACTORY_ADDRESS, config.PONS_FACTORY_CODE_HASH);
    const launch = await rpc.readContract({ address: config.PONS_FACTORY_ADDRESS, abi: ponsV2FactoryAbi, functionName: 'getLaunchedToken', args: [input.token], blockNumber: block });
    if (launch.exists && launch.curve !== zeroAddress) {
      const graduated = await rpc.readContract({ address: launch.curve, abi: ponsCurveAbi, functionName: 'graduated', blockNumber: block });
      if (!graduated) {
        if (launch.pairToken !== zeroAddress) throw new TradingError('This curve uses an ERC-20 quote asset. ETH routing is not available for it.', 422);
        const pool = await verifyPool(rpc, launch.curve.toLowerCase() as Address, 'pons-curve');
        const [reserves, feeBps, taxBps, sellable, realQuote] = await Promise.all([
          rpc.readContract({ address: launch.curve, abi: ponsCurveAbi, functionName: 'getReserves', blockNumber: block }), rpc.readContract({ address: launch.curve, abi: ponsCurveAbi, functionName: 'feeBps', blockNumber: block }), rpc.readContract({ address: launch.curve, abi: ponsCurveAbi, functionName: 'creatorTaxBps', blockNumber: block }), rpc.readContract({ address: launch.curve, abi: ponsCurveAbi, functionName: 'sellableTokens', blockNumber: block }), rpc.readContract({ address: launch.curve, abi: ponsCurveAbi, functionName: 'realQuoteReserve', blockNumber: block }),
        ]);
        let estimate; try { estimate = curveEstimate({ buy, amount, quoteReserve: reserves[0], tokenReserve: reserves[1], feeBps, taxBps, sellable, realQuote }); } catch (e) { throw new TradingError(e instanceof Error ? e.message : 'Curve quote unavailable.', 422); }
        // Pons scales a buy's quantity bound by the actually spent input on partial fill.
        // Encode a full-input price bound, while displaying the actual expected output.
        const minimum = buy ? estimate.out * amount / estimate.spent * BigInt(10000 - input.slippageBps) / BigInt(10000) : estimate.out * BigInt(10000 - input.slippageBps) / BigInt(10000);
        // Avoid quoting a pre-known partial fill with a quantity-shaped field. Users may retry a smaller amount.
        if (estimate.spent < amount) throw new TradingError('This amount crosses curve graduation. Reduce the buy size or wait for the graduated pool route.', 422);
        const q: TradeQuote = { ...base, provider: 'Pons curve', buyAmount: estimate.out.toString(), minBuyAmount: minimum.toString(), routes: ['Pons V2 bonding curve'], fees: [{ token: NATIVE, amount: estimate.fee.toString(), label: 'Curve fee' }, { token: NATIVE, amount: estimate.tax.toString(), label: 'Creator tax' }].filter(f => BigInt(f.amount) > BigInt(0)), spender: buy ? undefined : launch.curve, direct: { kind: 'pons-curve', factory: config.PONS_FACTORY_ADDRESS, pool: launch.curve, codeHash: pool.codeHash as Hex, block: Number(block), priceImpact: estimate.impact, partialFill: buy }, transaction: { to: launch.curve, data: '0x', value: buy ? amount.toString() : '0' } };
        if (input.account) q.transaction!.data = directCalldata(q, input.account); else delete q.transaction;
        if (q.executable) validateDirectExecution(q, input.account!);
        return q;
      }
      const v4 = await ponsV4Quote(base, { token: input.token, pairToken: launch.pairToken, poolFee: launch.poolFee, tickSpacing: launch.tickSpacing }, input.slippageBps, block);
      if (v4) { if (v4.executable) validateDirectExecution(v4, input.account!); return v4; }
    }
  }
  const factory = config.UNISWAP_FACTORY_ADDRESS, router = config.UNISWAP_ROUTER_ADDRESS, quoter = config.UNISWAP_QUOTER_ADDRESS, wrapped = config.WRAPPED_NATIVE_ADDRESS;
  if (!factory || !router || !quoter || !wrapped) throw new TradingError('No verified direct pool route is configured for this token. Graduated Pons V2 pools require the V4 route.', 422);
  await Promise.all([codePin(router, config.UNISWAP_ROUTER_CODE_HASH), codePin(quoter, config.UNISWAP_QUOTER_CODE_HASH)]);
  const [routerFactory, routerWrapped, quoterFactory, quoterWrapped] = await Promise.all([rpc.readContract({ address: router, abi: router02Abi, functionName: 'factory' }), rpc.readContract({ address: router, abi: router02Abi, functionName: 'WETH9' }), rpc.readContract({ address: quoter, abi: quoterV2Abi, functionName: 'factory' }), rpc.readContract({ address: quoter, abi: quoterV2Abi, functionName: 'WETH9' })]);
  if (![routerFactory, quoterFactory].every(a => sameAddress(a, factory)) || ![routerWrapped, quoterWrapped].every(a => sameAddress(a, wrapped))) throw new TradingError('Router, quoter and factory configuration do not match.', 503);
  const tokenIn = buy ? wrapped : input.token, tokenOut = buy ? input.token : wrapped;
  const options = await Promise.all([100, 500, 3000, 10000].map(async fee => {
    try { const pool = await rpc.readContract({ address: factory, abi: factoryAbi, functionName: 'getPool', args: [tokenIn, tokenOut, fee], blockNumber: block }); if (pool === zeroAddress) return null;
      await verifyPool(rpc, pool.toLowerCase() as Address, 'uniswap-v3');
      const result = await rpc.simulateContract({ address: quoter, abi: quoterV2Abi, functionName: 'quoteExactInputSingle', args: [{ tokenIn, tokenOut, amountIn: amount, fee, sqrtPriceLimitX96: BigInt(0) }], blockNumber: block });
      return { fee, pool, out: result.result[0] };
    } catch { return null; }
  }));
  const route = options.filter(o => o != null && o.out > BigInt(0)).sort((a, b) => a!.out > b!.out ? -1 : 1)[0];
  if (!route) throw new TradingError('No executable direct ETH pool was found for this token and amount.', 422);
  const code = await rpc.getCode({ address: router });
  const q: TradeQuote = { ...base, provider: 'Uniswap V3', buyAmount: route.out.toString(), minBuyAmount: (route.out * BigInt(10000 - input.slippageBps) / BigInt(10000)).toString(), routes: [`Uniswap V3 · ${route.fee / 10000}% pool fee`], fees: [], spender: buy ? undefined : router, direct: { kind: 'uniswap-v3', factory, wrappedNative: wrapped, fee: route.fee, pool: route.pool, codeHash: keccak256(code!), block: Number(block), priceImpact: null, partialFill: false }, transaction: { to: router, data: '0x', value: buy ? amount.toString() : '0' } };
  if (input.account) q.transaction!.data = directCalldata(q, input.account); else delete q.transaction;
  if (q.executable) validateDirectExecution(q, input.account!);
  return q;
}
