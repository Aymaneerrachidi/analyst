import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, type Hex } from 'viem';
import { transferAbi, v2SwapAbi, type RawLog } from '../lib/indexer/events';
import { verifiedWalletFills } from '../lib/indexer/webhook-receipt';
import { rpcCost, rpcGate, withinBudget } from '../lib/indexer/webhook-limits';
const wallet = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const quote = '0x3333333333333333333333333333333333333333';
const pool = { address: '0x4444444444444444444444444444444444444444', token0: token, token1: quote, kind: 'uniswap-v2', dex: 'Uniswap' };
const hash = `0x${'a'.repeat(64)}` as Hex;
const base = { blockHash: hash, transactionHash: hash, blockNumber: BigInt(10) };
const transfer: RawLog = { ...base, address: token, logIndex: 1, topics: encodeEventTopics({ abi: transferAbi, eventName: 'Transfer', args: { from: pool.address as Hex, to: wallet } }) as Hex[], data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(100)]) };
const swap: RawLog = { ...base, address: pool.address, logIndex: 2, topics: encodeEventTopics({ abi: v2SwapAbi, eventName: 'Swap', args: { sender: wallet, to: wallet } }) as Hex[], data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [BigInt(0), BigInt(20), BigInt(100), BigInt(0)]) };
test('ordinary transfers and unknown pools never become trades', () => {
  assert.equal(verifiedWalletFills([transfer], [pool], [wallet], [quote]).length, 0);
  assert.equal(verifiedWalletFills([transfer, swap], [], [wallet], [quote]).length, 0);
});
test('a registered pool fill and exact tracked wallet delta produce one trade', () => {
  const fills = verifiedWalletFills([transfer, swap], [pool], [wallet, wallet], [quote]);
  assert.equal(fills.length, 1); assert.equal(fills[0].swap.amountTokenRaw, BigInt(100));
});
test('incorrect wallet attribution and multiple fills remain unpublished', () => {
  assert.equal(verifiedWalletFills([transfer, swap], [pool], [quote], [quote]).length, 0);
  assert.equal(verifiedWalletFills([transfer, swap, { ...swap, logIndex: 3 }], [pool], [wallet], [quote]).length, 0);
});
test('budget rejects unknown calls, batches, invalid counters and exhausted limits', () => {
  assert.equal(rpcCost('{"method":"eth_call"}'), 26);
  assert.throws(() => rpcCost('{"method":"eth_getLogs"}'));
  assert.throws(() => rpcCost('[{"method":"eth_call"},{"method":"eth_call"}]'));
  assert.equal(withinBudget(80, 900, 20, 100, 1000), true);
  assert.equal(withinBudget(80, 990, 20, 100, 1000), false);
  assert.equal(withinBudget(NaN, 0, 1, 100, 1000), false);
});
test('concurrent metadata requests reserve budget sequentially before dispatch', async () => {
  const costs: number[] = []; let waiting = 0;
  const gate = rpcGate(async n => { assert.equal(waiting, 0); costs.push(n); }, async () => { waiting++; await Promise.resolve(); waiting--; });
  await Promise.all([gate('{"method":"eth_call"}'), gate('{"method":"eth_getCode"}')]);
  assert.deepEqual(costs, [26, 20]);
});
