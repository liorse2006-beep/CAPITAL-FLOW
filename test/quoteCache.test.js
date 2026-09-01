// quoteCache metadata is part of the scanners' truthfulness contract: a
// provider failure may use a tightly bounded recent fallback, but callers must
// be able to distinguish that from a fresh response.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const quoteCache = require('../server/services/quoteCache');
const yahoo = require('../server/services/yahoo');

test('quoteCache marks a provider failure separately when no stale quote exists', async (t) => {
  t.mock.method(yahoo, 'quote', async () => {
    throw new Error('simulated upstream outage');
  });

  const result = await quoteCache.getQuotes(['AUDIT_OUTAGE_UNCACHED']);

  assert.strictEqual(result.size, 0);
  assert.strictEqual(result.providerFailure, true);
  assert.strictEqual(result.usedStaleFallback, false);
  assert.deepEqual(result.staleSymbols, []);
  assert.strictEqual(result.staleCount, 0);
  assert.strictEqual(result.dataAsOf, null);
});

test('quoteCache reports a successful batch as fresh provider data', async (t) => {
  t.mock.method(yahoo, 'quote', async () => [
    {
      symbol: 'AUDIT_SUCCESS_UNCACHED',
      regularMarketPrice: 100,
    },
  ]);

  const result = await quoteCache.getQuotes(['AUDIT_SUCCESS_UNCACHED']);

  assert.strictEqual(result.size, 1);
  assert.strictEqual(result.providerFailure, false);
  assert.strictEqual(result.usedStaleFallback, false);
  assert.deepEqual(result.staleSymbols, []);
  assert.strictEqual(result.staleCount, 0);
  assert.match(result.dataAsOf, /^\d{4}-\d{2}-\d{2}T/);
});

test('quoteCache identifies the exact symbols served from a bounded stale fallback', async (t) => {
  const symbol = 'AUDIT_STALE_UNCACHED';
  let fail = false;
  const baseNow = Date.now();
  let clock = baseNow;
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(yahoo, 'quote', async () => {
    if (fail) throw new Error('simulated upstream outage');
    return [{ symbol, regularMarketPrice: 100 }];
  });

  await quoteCache.getQuotes([symbol]);
  clock += 4 * 60 * 1000;
  fail = true;
  const result = await quoteCache.getQuotes([symbol]);

  assert.equal(result.providerFailure, true);
  assert.equal(result.usedStaleFallback, true);
  assert.deepEqual(result.staleSymbols, [symbol]);
  assert.equal(result.staleCount, 1);
  assert.equal(result.get(symbol).regularMarketPrice, 100);
});
