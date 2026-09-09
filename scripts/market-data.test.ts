import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDexPairs, fetchDexQuotes } from '../lib/providers/market-data';
const address = `0x${'a'.repeat(40)}`;
const pair = { chainId: 'robinhood', baseToken: { address, symbol: 'TEST' }, priceUsd: '0.12', liquidity: { usd: 200 } };
test('selects deepest exact-address pool and rejects other chains and quote-only matches', () => {
  const result = normalizeDexPairs([pair, { ...pair, priceUsd: '0.15', liquidity: { usd: 500 } }, { ...pair, chainId: 'ethereum', liquidity: { usd: 9999 } }, { ...pair, baseToken: { address: `0x${'b'.repeat(40)}` }, quoteToken: { address } }], [address.toUpperCase()], 'robinhood');
  assert.equal(result.size, 1); assert.equal(result.get(address)?.price, 0.15);
});
test('malformed rows do not discard valid quotes and absent values remain unknown', () => {
  const result = normalizeDexPairs([{}, pair], [address], 'robinhood').get(address)!;
  assert.equal(result.marketCap, null); assert.equal(result.image, undefined); assert.equal(result.volume24h, null);
});
test('rejects malformed and negative monetary numbers but preserves negative price changes', () => {
  const result = normalizeDexPairs([{ ...pair, priceUsd: '12junk', marketCap: -1, volume: { h24: '' }, priceChange: { h24: -12 } }], [address], 'robinhood').get(address)!;
  assert.equal(result.price, null); assert.equal(result.marketCap, null); assert.equal(result.volume24h, null); assert.equal(result.priceChange24h, -12);
});
test('invalid API envelopes and oversized batches fail explicitly', async () => {
  assert.throws(() => normalizeDexPairs({}, [address], 'robinhood'));
  await assert.rejects(fetchDexQuotes(['invalid']));
  await assert.rejects(fetchDexQuotes(Array.from({ length: 31 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`)));
});
