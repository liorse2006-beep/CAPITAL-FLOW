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
      regularMarketTime: Math.floor(Date.now() / 1000),
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

test('quoteCache preserves product dot symbols and uses the freshest Yahoo session timestamp', async (t) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  t.mock.method(yahoo, 'quote', async (symbols) =>
    symbols.map((symbol) => ({
      symbol,
      regularMarketPrice: 100,
      regularMarketTime: nowSeconds - 60 * 60,
      postMarketTime: nowSeconds,
    }))
  );

  const result = await quoteCache.getQuotes(['AUDIT.B']);

  assert.strictEqual(result.size, 1);
  assert.strictEqual(result.get('AUDIT.B').symbol, 'AUDIT.B');
  assert.match(result.dataAsOf, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Math.abs(Date.parse(result.dataAsOf) - Date.now()) < 5000);
});

test('quoteCache recovers a missing quote from a complete timestamped Yahoo summary', async (t) => {
  const symbol = 'AUDIT_SUMMARY_RECOVERY';
  t.mock.method(yahoo, 'quote', async () => []);
  t.mock.method(yahoo, 'quoteSummary', async () => ({
    price: {
      symbol,
      shortName: 'Summary Recovery',
      regularMarketPrice: 100,
      regularMarketTime: Math.floor(Date.now() / 1000),
      regularMarketVolume: 1000,
      averageDailyVolume10Day: 1000,
      marketCap: 1000000,
    },
    summaryDetail: {},
  }));

  const result = await quoteCache.getQuotes([symbol]);

  assert.equal(result.size, 1);
  assert.equal(result.get(symbol).symbol, symbol);
  assert.equal(result.providerFailure, false);
  assert.deepEqual(result.providerStaleSymbols, []);
  assert.match(result.dataAsOf, /^\d{4}-\d{2}-\d{2}T/);
});

test('quoteCache rejects provider rows whose timestamp is outside the safe freshness window', async (t) => {
  const symbol = 'AUDIT_PROVIDER_STALE';
  t.mock.method(yahoo, 'quote', async () => [
    {
      symbol,
      regularMarketPrice: 100,
      regularMarketVolume: 1000,
      averageDailyVolume10Day: 1000,
      marketCap: 1000000,
      regularMarketTime: Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60,
    },
  ]);
  t.mock.method(yahoo, 'quoteSummary', async () => null);

  const result = await quoteCache.getQuotes([symbol]);

  assert.strictEqual(result.size, 0);
  assert.deepStrictEqual(result.providerStaleSymbols, [symbol]);
  assert.strictEqual(result.dataAsOf, null);
});
