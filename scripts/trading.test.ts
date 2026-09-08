import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, type Address } from "viem";
import { ALLOWANCE_HOLDER, NATIVE, holderAbi, settlerAbi, tradeInputSchema, umbraLink, unitsExact, validateExecution, type TradeQuote } from "../lib/trading/shared";

// Synthetic fixtures are confined to tests; production quotes always come from providers.
const account = "0x1111111111111111111111111111111111111111" as Address;
const token = "0x2222222222222222222222222222222222222222" as Address;
const settler = "0x3333333333333333333333333333333333333333" as Address;
const attacker = "0x4444444444444444444444444444444444444444" as Address;
const now = 1800000000000;
function makeQuote(sell = false): TradeQuote {
  const nested = encodeFunctionData({ abi: settlerAbi, functionName: "execute", args: [{ recipient: account, buyToken: sell ? NATIVE : token, minAmountOut: BigInt(99) }, ["0x12345678"], `0x${"00".repeat(32)}`] });
  return { provider: "0x", executable: true, account, sellToken: sell ? token : NATIVE, buyToken: sell ? NATIVE : token, sellAmount: "1000", buyAmount: "100", minBuyAmount: "99", sellDecimals: 18, buyDecimals: 18, expiresAt: now + 60_000, routes: ["Test venue"], fees: [], spender: sell ? ALLOWANCE_HOLDER : undefined, transaction: { to: sell ? ALLOWANCE_HOLDER : settler, value: sell ? "0" : "1000", data: sell ? encodeFunctionData({ abi: holderAbi, functionName: "exec", args: [settler, token, BigInt(1000), settler, nested] }) : nested } };
}
test("exact amounts reject rounding, exponent notation, zero and uint256 overflow", () => {
  assert.equal(unitsExact("1.123456", 6), BigInt(1123456));
  for (const value of ["1.1234567", "0", "-1", "1e5", " 1", "01", "Infinity"]) assert.throws(() => unitsExact(value, 6));
  assert.throws(() => unitsExact((BigInt(2) ** BigInt(256)).toString(), 0));
});
test("request schema bounds slippage and rejects extra transaction fields", () => {
  const body = { token, side: "buy", amount: "0.01", slippageBps: 50 };
  assert.ok(tradeInputSchema.safeParse(body).success);
  for (const change of [{ slippageBps: 10000 }, { slippageBps: -1 }, { transaction: {} }, { token: "0x0" }, { account: "0x0000000000000000000000000000000000000000" }]) assert.equal(tradeInputSchema.safeParse({ ...body, ...change }).success, false);
});
test("accepts native and exact-input ERC20 calls through genuine settlement contracts", () => {
  validateExecution(makeQuote(), account, [settler], now);
  validateExecution(makeQuote(true), account, [settler], now);
});
test("rejects expired quotes, different wallets, unverified providers and arbitrary spenders", () => {
  for (const change of [{ expiresAt: now }, { expiresAt: now + 90_000 }, { account: attacker }, { executable: false }, { provider: "Umbra" as const }, { spender: attacker }]) assert.throws(() => validateExecution({ ...makeQuote(), ...change }, account, [settler], now));
});
test("rejects arbitrary routers, unexpected ETH, allowance operators and input amounts", () => {
  let q = makeQuote(); q.transaction!.to = attacker; assert.throws(() => validateExecution(q, account, [settler], now));
  q = makeQuote(); q.transaction!.value = "1001"; assert.throws(() => validateExecution(q, account, [settler], now));
  for (const args of [[attacker, token, BigInt(1000), settler], [settler, attacker, BigInt(1000), settler], [settler, token, BigInt(1001), settler]] as const) {
    q = makeQuote(true); q.transaction!.data = encodeFunctionData({ abi: holderAbi, functionName: "exec", args: [...args, makeQuote().transaction!.data] });
    assert.throws(() => validateExecution(q, account, [settler], now));
  }
});
test("rejects encoded recipient, output token, slippage floor and empty actions tampering", () => {
  for (const change of [{ recipient: attacker }, { buyToken: attacker }, { minAmountOut: BigInt(1) }]) {
    const q = makeQuote(); q.transaction!.data = encodeFunctionData({ abi: settlerAbi, functionName: "execute", args: [{ recipient: account, buyToken: token, minAmountOut: BigInt(99), ...change }, ["0x12345678"], `0x${"00".repeat(32)}`] });
    assert.throws(() => validateExecution(q, account, [settler], now));
  }
  const q = makeQuote(); q.transaction!.data = "0xdeadbeef"; assert.throws(() => validateExecution(q, account, [settler], now));
});
test("external trade links preserve direction and exact entered amount", () => {
  const url = new URL(umbraLink({ token, side: "sell", amount: "12.123456" }));
  assert.equal(url.origin, "https://www.umbra.finance"); assert.equal(url.searchParams.get("pay"), token); assert.equal(url.searchParams.get("buy"), "ETH"); assert.equal(url.searchParams.get("amt"), "12.123456");
});
