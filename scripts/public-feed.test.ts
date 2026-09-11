import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptMovements, normalizeMovement, TRANSFER, USDG, V4_MANAGER, type Receipt } from '../lib/providers/public-receipt';
const w = '0x' + '1'.repeat(40), r = V4_MANAGER, t = '0x' + '3'.repeat(40), payer = '0x' + '4'.repeat(40);
const topic = (a: string) => '0x' + a.slice(2).padStart(64, '0');
const transfer = (token: string, from: string, to: string, n: number) => ({ address: token, topics: [TRANSFER, topic(from), topic(to)], data: '0x' + n.toString(16).padStart(64, '0') });
const swap = { address: V4_MANAGER, topics: ['0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f'], data: '0x' };
const receipt = (logs: Receipt['logs']): Receipt => ({ status: '0x1', transactionHash: '0x' + 'a'.repeat(64), blockHash: '0x' + 'b'.repeat(64), blockNumber: '0x1', logs: [swap, ...logs] });
const wallets = new Set([w]);
test('direct buy and sell require opposing cash and token deltas', () => {
  const buy = receiptMovements(receipt([transfer(USDG,w,r,20),transfer(t,r,w,100)]),wallets);
  assert.equal(buy[0]?.side,'BUY');assert.equal(buy[0].cash,BigInt(20));
  assert.equal(receiptMovements(receipt([transfer(t,w,r,100),transfer(USDG,r,w,20)]),wallets)[0]?.side,'SELL');
  assert.equal(receiptMovements(receipt([transfer(t,r,w,100),transfer(USDG,r,w,20)]),wallets).length,0);
});
test('relay buy uses its exact single cash leg', () => {
  const relay = '0x' + '2'.repeat(40);
  const value=receipt([transfer(USDG,payer,relay,2000000),transfer(USDG,relay,V4_MANAGER,2000000),transfer(t,V4_MANAGER,relay,100),transfer(t,relay,w,100)]);
  const movement=receiptMovements(value,wallets)[0];assert.equal(movement.attribution,'relay-cash');
  const row=normalizeMovement(movement,value,'2026-09-11T00:00:00Z',{symbol:'T',name:'Token',decimals:2},0.99)!;
  assert.equal(row.amountUsd,1.98);assert.equal(row.tokenAmount,1);
  assert.equal(normalizeMovement(movement,value,row.timestamp,{symbol:'T',name:'Token',decimals:2})!.amountUsd,undefined);
});
test('reject transfer-only, reverted, removed, NFT and ambiguous multi-token receipts', () => {
  const value=receipt([transfer(USDG,w,r,20),transfer(t,r,w,100)]);
  assert.equal(receiptMovements({...value,logs:value.logs.slice(1)},wallets).length,0);
  assert.equal(receiptMovements({...value,status:'0x0'},wallets).length,0);
  assert.equal(receiptMovements({...value,logs:value.logs.map(l=>({...l,removed:true}))},wallets).length,0);
  assert.equal(receiptMovements(receipt([transfer(USDG,w,r,20),{...transfer(t,r,w,100),topics:[TRANSFER,topic(r),topic(w),topic(t)]}]),wallets).length,0);
  assert.equal(receiptMovements(receipt([...value.logs,transfer(payer,r,w,100)]),wallets).length,0);
});
test('reject shared relay output and multi-wallet attribution', () => {
  const value=receipt([transfer(USDG,payer,r,20),transfer(t,V4_MANAGER,r,100),transfer(t,r,w,50),transfer(t,r,payer,50)]);
  assert.equal(receiptMovements(value,wallets).length,0);
  assert.equal(receiptMovements(value,new Set([w,payer])).length,0);
});
