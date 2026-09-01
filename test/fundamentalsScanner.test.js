// server/services/fundamentalsScanner.js — swing-trading fundamentals
// (float, short interest, current/forward P/E, PEG, debt/equity, 5yr revenue
// growth, next earnings date) for a ticker the customer picked themselves.
//
// Regression coverage: floatShares/shortPercentOfFloat do NOT exist on
// Yahoo's plain quote() response (they live only in quoteSummary's
// defaultKeyStatistics module) — reading them off the quote object silently
// returned undefined→0 for every single lookup, which read to a customer as
// "the data is just wrong" rather than "missing". These tests assert the
// data comes from quoteSummary, and that a real source failure is reported
// as unverified rather than silently rendered as "—" same as genuinely
// absent data.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');
before(async () => {
  await db.ready;
});

const quoteCache = require('../server/services/quoteCache');
const finnhub = require('../server/services/finnhub');
const yahoo = require('../server/services/yahoo');
const { scanFundamentals } = require('../server/services/fundamentalsScanner');

function quotesMapFor(entries) {
  const map = new Map();
  entries.forEach(([symbol, marketCap]) => {
    map.set(symbol, {
      symbol,
      shortName: symbol + ' Inc.',
      regularMarketPrice: 50,
      regularMarketChangePercent: 1.5,
      marketCap,
    });
  });
  return map;
}

function addQuoteMetadata(map, metadata) {
  Object.defineProperties(map, {
    dataAsOf: { value: metadata.dataAsOf || '2026-09-01T10:00:00.000Z' },
    staleCount: { value: metadata.staleCount || 0 },
    usedStaleFallback: { value: metadata.usedStaleFallback === true },
    providerFailure: { value: metadata.providerFailure === true },
  });
  return map;
}

function keyStats(overrides) {
  return Object.assign(
    {
      defaultKeyStatistics: {
        floatShares: 2e7,
        shortPercentOfFloat: 0.08,
        forwardPE: 24.8,
        pegRatio: 1.6,
      },
      calendarEvents: { earnings: { earningsDate: [] } },
    },
    overrides
  );
}

test('scanFundamentals has no market-cap floor — a small-cap ticker the customer chose is still looked up', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor([['TINY', 5e7]])); // $50M — would have failed the old universe-scan floor
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({ peRatio: 20, debtToEquity: 0.5, revenueGrowth5Y: 12.3 }));
  t.mock.method(yahoo, 'quoteSummary', async () => keyStats());

  const { results } = await scanFundamentals(['TINY']);
  assert.deepStrictEqual(
    results.map((r) => r.symbol),
    ['TINY']
  );
});

test('scanFundamentals reads float and short interest from quoteSummary (defaultKeyStatistics), not the plain quote object', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor([['AAPL', 3e12]]));
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({
    peRatio: 31.2,
    debtToEquity: 1.45,
    revenueGrowth5Y: 8.9,
  }));
  t.mock.method(yahoo, 'quoteSummary', async () =>
    keyStats({
      defaultKeyStatistics: {
        floatShares: 1.44e10,
        shortPercentOfFloat: 0.01,
        forwardPE: 24.8,
        pegRatio: 1.6,
      },
      calendarEvents: { earnings: { earningsDate: ['2026-11-05T00:00:00.000Z'] } },
    })
  );

  const { results } = await scanFundamentals(['AAPL']);
  assert.strictEqual(results.length, 1);
  const r = results[0];
  assert.strictEqual(r.floatShares, 1.44e10);
  assert.strictEqual(r.shortPercent, 0.01);
  assert.strictEqual(r.peRatio, 31.2);
  assert.strictEqual(r.forwardPE, 24.8);
  assert.strictEqual(r.pegRatio, 1.6);
  assert.strictEqual(r.debtToEquity, 1.45);
  assert.strictEqual(r.revenueGrowth5Y, 8.9);
  assert.strictEqual(r.nextEarningsDate, '2026-11-05');
  Object.entries(r.unverified).forEach(([key, value]) => {
    assert.strictEqual(value, false, `${key} loaded successfully`);
  });
});

test('scanFundamentals never fabricates a value Finnhub/Yahoo did not report', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor([['THIN', 5e9]]));
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({})); // no fields reported at all
  t.mock.method(yahoo, 'quoteSummary', async () => keyStats({ defaultKeyStatistics: {}, calendarEvents: {} }));

  const { results } = await scanFundamentals(['THIN']);
  assert.strictEqual(results.length, 1);
  const r = results[0];
  assert.strictEqual(r.peRatio, null);
  assert.strictEqual(r.debtToEquity, null);
  assert.strictEqual(r.revenueGrowth5Y, null, 'null, not 0 — 0% growth and "unknown" must stay distinguishable');
  assert.strictEqual(r.nextEarningsDate, null);
  assert.strictEqual(r.floatShares, null);
  assert.strictEqual(r.forwardPE, null);
  assert.strictEqual(r.pegRatio, null);
});

test('scanFundamentals flags a group as unverified (not "—") when the source genuinely fails to answer', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor([['FLAKY', 5e9]]));
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => {
    throw new Error('Finnhub 500');
  });
  t.mock.method(yahoo, 'quoteSummary', async () => keyStats());

  const { results } = await scanFundamentals(['FLAKY']);
  const r = results[0];
  assert.strictEqual(r.unverified.peRatio, true, 'Finnhub failing must not look identical to "no P/E reported"');
  assert.strictEqual(r.unverified.debtToEquity, true);
  assert.strictEqual(r.unverified.revenueGrowth5Y, true);
  assert.strictEqual(r.unverified.forwardPE, false);
  assert.strictEqual(r.unverified.pegRatio, false);
  assert.strictEqual(r.unverified.floatShares, false, 'the Yahoo-sourced group succeeded independently');
});

test('scanFundamentals skips a ticker Yahoo has no quote for at all, without crashing the scan', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor([['KNOWN', 5e9]])); // GHOST omitted
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({ peRatio: 10, debtToEquity: 0.2, revenueGrowth5Y: 5 }));
  t.mock.method(yahoo, 'quoteSummary', async () => keyStats());

  const { results, errors } = await scanFundamentals(['KNOWN', 'GHOST']);
  assert.deepStrictEqual(
    results.map((r) => r.symbol),
    ['KNOWN']
  );
  assert.ok(errors.includes('GHOST'));
});

test('scanFundamentals exposes stale quote provenance instead of claiming a complete result', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () =>
    addQuoteMetadata(quotesMapFor([['AAPL', 3e12]]), {
      usedStaleFallback: true,
      staleCount: 1,
      dataAsOf: '2026-09-01T09:55:00.000Z',
    })
  );
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({ peRatio: 31.2 }));
  t.mock.method(yahoo, 'quoteSummary', async () => keyStats());

  const result = await scanFundamentals(['AAPL']);

  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(result.dataStatus, 'partial');
  assert.strictEqual(result.quoteDataStatus, 'stale');
  assert.strictEqual(result.staleCount, 1);
  assert.strictEqual(result.dataAsOf, '2026-09-01T09:55:00.000Z');
});
