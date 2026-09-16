// Provider outages must be visible to callers. An all-symbol failure is not
// an empty, trustworthy scan and must never be presented as "no signals".
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');
const quoteCache = require('../server/services/quoteCache');
const finnhub = require('../server/services/finnhub');
const yahoo = require('../server/services/yahoo');
const { scanTickers, mapWithConcurrency } = require('../server/services/scanner');
const { scanMA } = require('../server/services/maScanner');

before(async () => {
  await db.ready;
});

function quote(symbol) {
  return {
    symbol,
    shortName: symbol,
    regularMarketPrice: 100,
    regularMarketVolume: 5_000_000,
    averageDailyVolume10Day: 2_000_000,
    marketCap: 5_000_000_000,
  };
}

function quoteMapWithMetadata(entries, metadata) {
  const map = new Map(entries);
  Object.defineProperties(map, {
    dataAsOf: { value: metadata.dataAsOf || '2026-09-01T10:00:00.000Z' },
    staleCount: { value: metadata.staleCount || 0 },
    usedStaleFallback: { value: metadata.usedStaleFallback === true },
    providerFailure: { value: metadata.providerFailure === true },
  });
  return map;
}

test('Capital Flow marks a total quote outage as unavailable', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => new Map());

  const result = await scanTickers(['MISSING1', 'MISSING2'], { minVolumeRatio: 1.5, minMarketCap: 1 });

  assert.deepStrictEqual(result.results, []);
  assert.strictEqual(result.errors.length, 2);
  assert.strictEqual(result.dataStatus, 'unavailable');
});

test('Capital Flow keeps a partial quote outage distinct from a total outage', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => new Map([['AVAILABLE', quote('AVAILABLE')]]));

  const result = await scanTickers(['AVAILABLE', 'MISSING'], { minVolumeRatio: 1.5, minMarketCap: 1 });

  assert.strictEqual(result.dataStatus, 'partial');
  assert.deepStrictEqual(result.errors, ['MISSING']);
});

test('Capital Flow keeps an FMP quote authoritative during enrichment', async (t) => {
  const symbol = 'AUDIT_FMP_SCAN_PRIMARY';
  t.mock.method(quoteCache, 'getQuotes', async () =>
    quoteMapWithMetadata(
      [
        [
          symbol,
          {
            ...quote(symbol),
            quoteProvider: 'FMP',
            regularMarketChangePercent: 1.25,
            regularMarketDayHigh: 101,
            regularMarketDayLow: 99,
            regularMarketPreviousClose: 98.75,
          },
        ],
      ],
      { dataAsOf: '2026-09-16T10:00:00.000Z' }
    )
  );

  let finnhubQuoteCalls = 0;
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => {
    finnhubQuoteCalls++;
    return {
      price: 999,
      change: 99,
      dayHigh: 1000,
      dayLow: 998,
      prevClose: 997,
    };
  });
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => null);
  t.mock.method(yahoo, 'chart', async () => ({ quotes: [] }));
  t.mock.method(yahoo, 'quoteSummary', async () => ({ assetProfile: { sector: 'Technology' } }));

  const result = await scanTickers([symbol], { minVolumeRatio: 1.5, minMarketCap: 1 });

  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(result.results[0].quoteProvider, 'FMP');
  assert.strictEqual(result.results[0].price, 100);
  assert.strictEqual(result.results[0].change, 1.25);
  assert.strictEqual(finnhubQuoteCalls, 0);
});

test('Moving Average marks a total quote outage as unavailable', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => new Map());

  const result = await scanMA(['MISSING1', 'MISSING2'], { ma: 20, distance: 2, interval: '1d' });

  assert.deepStrictEqual(result.results, []);
  assert.strictEqual(result.errors.length, 2);
  assert.strictEqual(result.dataStatus, 'unavailable');
});

test('Capital Flow marks a stale quote fallback as partial, not complete', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () =>
    quoteMapWithMetadata([], { usedStaleFallback: true, staleCount: 1 })
  );

  const result = await scanTickers([], { minVolumeRatio: 1.5, minMarketCap: 1 });

  assert.strictEqual(result.dataStatus, 'partial');
  assert.strictEqual(result.quoteDataStatus, 'stale');
  assert.strictEqual(result.staleCount, 1);
});

test('Moving Average marks a stale quote fallback as partial, not complete', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () =>
    quoteMapWithMetadata([], { usedStaleFallback: true, staleCount: 1 })
  );

  const result = await scanMA([], { ma: 20, distance: 2, interval: '1d' });

  assert.strictEqual(result.dataStatus, 'partial');
  assert.strictEqual(result.quoteDataStatus, 'stale');
  assert.strictEqual(result.staleCount, 1);
});

test('scanner enrichment stays bounded while preserving result order', async () => {
  let active = 0;
  let peak = 0;
  const values = await mapWithConcurrency([0, 1, 2, 3, 4, 5, 6], 3, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return value * 2;
  });

  assert.deepStrictEqual(values, [0, 2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 3, `expected at most three workers, saw ${peak}`);
});
