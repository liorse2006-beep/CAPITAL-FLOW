// Provider outages must be visible to callers. An all-symbol failure is not
// an empty, trustworthy scan and must never be presented as "no signals".
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');
const quoteCache = require('../server/services/quoteCache');
const { scanTickers } = require('../server/services/scanner');
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
