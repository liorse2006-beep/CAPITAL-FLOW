// server/utils/ttlCache.js — the shared in-memory cache backing the chart
// route (and any future short-lived, expensive-to-refetch response).
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');

const { createTTLCache } = require('../server/utils/ttlCache');

test('returns undefined for a key that was never set', () => {
  const cache = createTTLCache(1000);
  assert.strictEqual(cache.get('missing'), undefined);
});

test('returns the stored value while within the TTL', () => {
  const cache = createTTLCache(1000);
  cache.set('AAPL:1M', { price: 200 });
  assert.deepStrictEqual(cache.get('AAPL:1M'), { price: 200 });
});

test('expires and removes the entry once the TTL has elapsed', async () => {
  const cache = createTTLCache(20);
  cache.set('AAPL:1M', { price: 200 });
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(cache.get('AAPL:1M'), undefined);
});

test('different keys do not collide', () => {
  const cache = createTTLCache(1000);
  cache.set('AAPL:1M', { price: 200 });
  cache.set('AAPL:1Y', { price: 999 });
  assert.deepStrictEqual(cache.get('AAPL:1M'), { price: 200 });
  assert.deepStrictEqual(cache.get('AAPL:1Y'), { price: 999 });
});
