import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStalkTrade } from '../lib/providers/stalkchain';
const row = { kind: 'trade', time: '2026-09-09T03:22:52.000Z', wallet: `0x${'1'.repeat(40)}`, token: `0x${'2'.repeat(40)}`, txHash: `0x${'a'.repeat(64)}`, side: 'buy', tokenAmount: 10, usdAmount: 25 };
test('normalizes genuine trade shape and derives execution price from amounts', () => { const r = parseStalkTrade(row)!; assert.equal(r.side, 'BUY'); assert.equal(r.price, 2.5); assert.equal(r.amountUsd, 25); });
test('rejects LP activity, malformed hashes and invalid amounts', () => { assert.equal(parseStalkTrade({ ...row, kind: 'lp' }), null); assert.equal(parseStalkTrade({ ...row, txHash: 'bad' }), null); assert.equal(parseStalkTrade({ ...row, tokenAmount: -1 }), null); });
test('source price sanity flags suppress bad valuations', () => { const r = parseStalkTrade({ ...row, priceIsSane: false })!; assert.equal(r.amountUsd, undefined); assert.equal(r.price, undefined); assert.equal(r.tokenAmount, 10); });
test('zero or missing quantity never invents execution price', () => { assert.equal(parseStalkTrade({ ...row, tokenAmount: 0 })!.price, undefined); assert.equal(parseStalkTrade({ ...row, usdAmount: null })!.amountUsd, undefined); });
test('wallet history receives the explicitly requested wallet identity', () => { const r = parseStalkTrade({ ...row, wallet: undefined }, row.wallet)!; assert.equal(r.wallet, row.wallet); });
