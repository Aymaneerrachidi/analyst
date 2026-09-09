import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keccak256, type Address } from 'viem';
import { NATIVE, tradeInputSchema, unitsExact, type TradeQuote } from '../lib/trading/shared';
import { directCalldata, validateDirectExecution, verifyDirectRoute } from '../lib/trading/direct-shared';
const account = `0x${'1'.repeat(40)}` as Address, token = `0x${'2'.repeat(40)}` as Address, router = `0x${'3'.repeat(40)}` as Address, wrapped = `0x${'4'.repeat(40)}` as Address;
const now = 1800000000000;
function makeQuote(sell = false): TradeQuote {
 const q: TradeQuote = { provider: 'Uniswap V3', executable: true, account, sellToken: sell ? token : NATIVE, buyToken: sell ? NATIVE : token, sellAmount: '1000', buyAmount: '100', minBuyAmount: '99', sellDecimals: 18, buyDecimals: 18, expiresAt: now + 60000, routes: ['Test fixture'], fees: [], spender: sell ? router : undefined, transaction: { to: router, data: '0x', value: sell ? '0' : '1000' }, direct: { kind: 'uniswap-v3', factory: router, pool: router, wrappedNative: wrapped, fee: 3000, codeHash: keccak256('0x6000'), block: 100, priceImpact: null, partialFill: false } };
 q.transaction!.data = directCalldata(q, account); return q;
}
test('exact amounts reject rounding, exponents, zero and uint256 overflow', () => {
 assert.equal(unitsExact('1.123456', 6), BigInt(1123456));
 for (const value of ['1.1234567','0','-1','1e5',' 1','01','Infinity']) assert.throws(() => unitsExact(value, 6));
 assert.throws(() => unitsExact((BigInt(2) ** BigInt(256)).toString(), 0));
});
test('trade schema bounds slippage and rejects supplied transaction fields', () => {
 const body = { token, side: 'buy', amount: '0.01', slippageBps: 50 };
 assert.ok(tradeInputSchema.safeParse(body).success);
 for (const change of [{ slippageBps: 10000 }, { transaction: {} }, { token: '0x0' }]) assert.equal(tradeInputSchema.safeParse({ ...body, ...change }).success, false);
});
test('V3 native and ERC20 routes validate their exact calldata', () => {
 validateDirectExecution(makeQuote(), account, now); validateDirectExecution(makeQuote(true), account, now);
});
test('expired, foreign wallet and incorrect native value quotes fail', () => {
 assert.throws(() => validateDirectExecution(makeQuote(), account, now + 60000));
 assert.throws(() => validateDirectExecution(makeQuote(), wrapped, now));
 const q = makeQuote(); q.transaction!.value = '1001'; assert.throws(() => validateDirectExecution(q, account, now));
});
test('recipient, amount, output token and minimum tampering fails', () => {
 for (const patch of [{ sellAmount: '2000' }, { buyToken: wrapped }, { minBuyAmount: '98' }]) assert.throws(() => validateDirectExecution({ ...makeQuote(), ...patch }, account, now));
 const q = makeQuote(); q.transaction!.data = directCalldata(q, wrapped); assert.throws(() => validateDirectExecution(q, account, now));
});
test('ERC20 spender must match the verified direct route', () => {
 const q = makeQuote(true); q.spender = wrapped; assert.throws(() => validateDirectExecution(q, account, now));
});
test('changed or missing router bytecode fails before a wallet request', async () => {
 const q = makeQuote();
 for (const code of ['0x', '0x6001'] as const) await assert.rejects(verifyDirectRoute({ getCode: async () => code, readContract: async () => router } as unknown as Parameters<typeof verifyDirectRoute>[0], q), /bytecode changed/);
});
