// Provider outages must be visible to callers. An all-symbol failure is not
// an empty, trustworthy scan and must never be presented as "no signals".
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');
const quoteCache = require('../server/services/quoteCache');
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
