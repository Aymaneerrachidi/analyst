import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLeaderboard } from '../lib/providers/leaderboard-data';
const row = { address: `0x${'a'.repeat(40)}`, networkId: 4663, realizedProfitUsd1w: '-12.5', swaps1w: 10, winRate1w: 40, volumeUsd1w: '100' };
test('leaderboard preserves losses and only periods with real metrics', () => { const result = normalizeLeaderboard([row]); assert.equal(result.length, 1); assert.equal(result[0].pnl, -12.5); assert.equal(result[0].period, '7d'); });
test('missing PnL and one-year PnL never become zero or all-time rankings', () => { assert.deepEqual(normalizeLeaderboard([{ ...row, realizedProfitUsd1w: null, realizedProfitUsd1y: '1000' }]), []); });
test('wrong-chain data is rejected and repeated wallets deduplicate', () => { assert.throws(() => normalizeLeaderboard([{ ...row, networkId: 1 }])); assert.equal(normalizeLeaderboard([row, row]).length, 1); });
test('invalid win rates and fractional trade counts stay unknown', () => { const [r] = normalizeLeaderboard([{ ...row, winRate1w: 200, swaps1w: 2.5 }]); assert.equal(r.winRate, null); assert.equal(r.trades, null); });
