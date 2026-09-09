import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWalletTokens } from '../lib/providers/wallet-token-data';
const wallet = `0x${'a'.repeat(40)}`, token = `0x${'b'.repeat(40)}`;
const row = { address: wallet, tokenAddress: token, networkId: 4663, realizedProfitUsd1d: '-25', realizedProfitUsd1w: '100', buys1d: 2, sells1d: 1, amountBoughtUsd1d: '30', avgHoldPeriodSec1d: '3600' };
test('token performance keeps periods separate and preserves losses', () => {
  const rows = normalizeWalletTokens([row], wallet);
  assert.equal(rows.length, 2); assert.equal(rows[0].pnl, -25); assert.equal(rows[0].period, '24h'); assert.equal(rows[1].pnl, 100); assert.equal(rows[0].holdingSeconds, 3600);
});
test('other chains and wallets never enter a Robinhood profile', () => {
  assert.deepEqual(normalizeWalletTokens([{ ...row, networkId: 1 }, { ...row, address: token }], wallet), []);
});
test('duplicate tokens deduplicate and unavailable stats remain unknown', () => {
  const [result] = normalizeWalletTokens([row, { ...row, buys1d: -1, sells1d: 0.5 }], wallet);
  assert.equal(result.buys, null); assert.equal(result.sells, null); assert.equal(result.soldUsd, null);
  assert.equal(normalizeWalletTokens([row, row], wallet).length, 2);
});
