// The MA scanner's daily closes cache (server/services/maScanner.js) — a
// second scan on the same day must not refetch hundreds of charts.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');

before(async () => {
  await db.ready;
});

const yahoo = require('../server/services/yahoo');
const quoteCache = require('../server/services/quoteCache');
const { scanMA } = require('../server/services/maScanner');

function quotesMapFor(symbols) {
  const map = new Map();
  symbols.forEach((s) => {
    map.set(s, {
      symbol: s,
      shortName: s + ' Inc.',
      regularMarketPrice: 100,
      regularMarketChangePercent: 1,
      regularMarketVolume: 5e6,
      averageDailyVolume10Day: 4e6,
      marketCap: 5e9,
    });
  });
  return map;
}

// 30 flat closes at 100 → SMA20 = 100, price 100 → distance 0%, matches.
const CLOSES = Array.from({ length: 30 }, (_, i) => ({ close: 100, date: new Date(Date.now() - (30 - i) * 864e5) }));

test('a second same-day MA scan reuses cached closes instead of refetching charts', async (t) => {
  const symbols = ['CACH1', 'CACH2', 'CACH3'];
  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor(symbols));
  const chartMock = t.mock.method(yahoo, 'chart', async () => ({ quotes: CLOSES }));

  const first = await scanMA(symbols, { ma: 20, distance: 2, interval: '1d' });
  assert.strictEqual(first.results.length, 3);
  assert.strictEqual(chartMock.mock.callCount(), 3, 'first scan fetches one chart per symbol');

  const second = await scanMA(symbols, { ma: 20, distance: 2, interval: '1d' });
  assert.strictEqual(second.results.length, 3);
  assert.strictEqual(chartMock.mock.callCount(), 3, 'second scan must make ZERO new chart calls');
});

test('a larger MA than the cached window covers triggers a refetch for that symbol', async (t) => {
  const symbols = ['CACHBIG'];
  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor(symbols));

  // First scan: small window (30 bars) cached by the SMA20 scan above's pattern
  const small = Array.from({ length: 30 }, (_, i) => ({ close: 100, date: new Date(Date.now() - (30 - i) * 864e5) }));
  const big = Array.from({ length: 200 }, (_, i) => ({ close: 100, date: new Date(Date.now() - (200 - i) * 864e5) }));
  let calls = 0;
  t.mock.method(yahoo, 'chart', async () => {
    calls++;
    return { quotes: calls === 1 ? small : big };
  });

  await scanMA(symbols, { ma: 20, distance: 2, interval: '1d' });
  assert.strictEqual(calls, 1);

  // SMA150 needs 150 bars — the 30-bar cache entry can't serve it.
  const res = await scanMA(symbols, { ma: 150, distance: 2, interval: '1d' });
  assert.strictEqual(calls, 2, 'insufficient cached bars must refetch');
  assert.strictEqual(res.results.length, 1);
});
