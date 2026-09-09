import 'server-only';
import { keccak256, zeroAddress, type Address, type Hex } from 'viem';
import { chainClient } from '@/lib/indexer/rpc';
import { v2Config } from '@/lib/v2/config';
import { NATIVE, sameAddress, type TradeQuote } from './shared';
import { v4Calldata, v4QuoterAbi, universalRouterAbi, ponsV4GettersAbi } from './v4-shared';
export async function ponsV4Quote(base: Pick<TradeQuote, 'account' | 'executable' | 'sellToken' | 'buyToken' | 'sellAmount' | 'sellDecimals' | 'buyDecimals' | 'expiresAt'>, launch: { token: Address; pairToken: Address; poolFee: number; tickSpacing: number }, slippageBps: number, block: bigint): Promise<TradeQuote | null> {
  const c = v2Config(), rpc = chainClient();
  if (!c.UNISWAP_V4_POOL_MANAGER || !c.UNISWAP_V4_ROUTER || !c.UNISWAP_V4_QUOTER || !c.UNISWAP_V4_ROUTER_CODE_HASH || !c.UNISWAP_V4_QUOTER_CODE_HASH || !c.PONS_FACTORY_ADDRESS) return null;
  if (launch.pairToken !== zeroAddress) return null;
  const buy = sameAddress(base.sellToken, NATIVE);
  if (!buy && (!c.PERMIT2_ADDRESS || !c.PERMIT2_CODE_HASH)) throw new Error('Verified Permit2 configuration is required for V4 token sells.');
  const [routerCode, quoterCode, manager, hooks, routerManager, quoterManager] = await Promise.all([
    rpc.getCode({ address: c.UNISWAP_V4_ROUTER }), rpc.getCode({ address: c.UNISWAP_V4_QUOTER }), rpc.readContract({ address: c.PONS_FACTORY_ADDRESS, abi: ponsV4GettersAbi, functionName: 'poolManager' }), rpc.readContract({ address: c.PONS_FACTORY_ADDRESS, abi: ponsV4GettersAbi, functionName: 'memeHook' }), rpc.readContract({ address: c.UNISWAP_V4_ROUTER, abi: universalRouterAbi, functionName: 'poolManager' }), rpc.readContract({ address: c.UNISWAP_V4_QUOTER, abi: v4QuoterAbi, functionName: 'poolManager' }),
  ]);
  if (!routerCode || !quoterCode || keccak256(routerCode).toLowerCase() !== c.UNISWAP_V4_ROUTER_CODE_HASH.toLowerCase() || keccak256(quoterCode).toLowerCase() !== c.UNISWAP_V4_QUOTER_CODE_HASH.toLowerCase() || ![manager, routerManager, quoterManager].every(a => sameAddress(a, c.UNISWAP_V4_POOL_MANAGER!))) throw new Error('V4 deployment verification failed.');
  if (!buy) { const code = await rpc.getCode({ address: c.PERMIT2_ADDRESS! }); if (!code || keccak256(code).toLowerCase() !== c.PERMIT2_CODE_HASH!.toLowerCase()) throw new Error('Permit2 verification failed.'); }
  const poolKey = { currency0: zeroAddress, currency1: launch.token, fee: launch.poolFee, tickSpacing: launch.tickSpacing, hooks };
  const amount = BigInt(base.sellAmount); if (amount >= BigInt(2) ** BigInt(128)) throw new Error('Amount exceeds V4 capacity.');
  const { result } = await rpc.simulateContract({ address: c.UNISWAP_V4_QUOTER, abi: v4QuoterAbi, functionName: 'quoteExactInputSingle', args: [{ poolKey, zeroForOne: buy, exactAmount: amount, hookData: '0x' }], blockNumber: block, ...(base.account ? { account: base.account } : {}) });
  if (result[0] <= BigInt(0)) throw new Error('V4 pool has no quoted output.');
  const q: TradeQuote = { ...base, provider: 'Uniswap V4', buyAmount: result[0].toString(), minBuyAmount: (result[0] * BigInt(10000 - slippageBps) / BigInt(10000)).toString(), routes: ['Pons graduated Uniswap V4 pool'], fees: [], spender: buy ? undefined : c.PERMIT2_ADDRESS, transaction: { to: c.UNISWAP_V4_ROUTER, data: '0x', value: buy ? base.sellAmount : '0' }, direct: { kind: 'uniswap-v4', factory: manager, pool: manager, codeHash: keccak256(routerCode), block: Number(block), priceImpact: null, partialFill: false, v4: { poolKey, routerVersion: c.UNISWAP_V4_ROUTER_ABI_VERSION, ...(!buy ? { permit2: c.PERMIT2_ADDRESS, permit2CodeHash: c.PERMIT2_CODE_HASH as Hex } : {}) } } };
  if (base.account) q.transaction!.data = v4Calldata(q); else delete q.transaction;
  return q;
}
