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

test('user-selected keys cannot grow the default cache beyond 500 entries', () => {
  const cache = createTTLCache(60000);
  for (let i = 0; i < 25000; i++) cache.set('ticker-' + i, { price: i });
  assert.strictEqual(cache.size, 500);
  assert.strictEqual(cache.get('ticker-0'), undefined);
  assert.deepStrictEqual(cache.get('ticker-24999'), { price: 24999 });
});

test('cache evicts least-recently-used entries without renewing their lifetime', (context) => {
  let current = 1000;
  context.mock.method(Date, 'now', () => current);
  const cache = createTTLCache(100, { maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  current = 1050;
  assert.strictEqual(cache.get('a'), 1);
  cache.set('c', 3);
  assert.strictEqual(cache.get('b'), undefined);
  current = 1100;
  assert.strictEqual(cache.get('a'), undefined, 'a read does not make old data current again');
  assert.strictEqual(cache.get('c'), 3);
});

test('new writes reclaim expired entries even when their keys are never read again', (context) => {
  let current = 1000;
  context.mock.method(Date, 'now', () => current);
  const cache = createTTLCache(20);
  for (let i = 0; i < 500; i++) cache.set('old-' + i, i);
  current = 1020;
  cache.set('new', 1);
  assert.strictEqual(cache.size, 1);
});

test('invalid cache limits are rejected instead of allowing unbounded retention', () => {
  for (const ttl of [0, -1, Infinity, NaN]) assert.throws(() => createTTLCache(ttl), TypeError);
  for (const maxEntries of [0, -1, Infinity, 1.5, NaN])
    assert.throws(() => createTTLCache(100, { maxEntries }), TypeError);
});
