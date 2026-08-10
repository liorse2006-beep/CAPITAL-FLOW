// server/services/fundamentalsScanner.js — swing-trading fundamentals
// (float, short interest, P/E, debt/equity, 5yr revenue growth, next
// earnings date) for a ticker the customer picked themselves. 0/null must
// always mean "the data source didn't report this" — never a guessed number.
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
  entries.forEach(([symbol, marketCap, extra]) => {
    map.set(
      symbol,
      Object.assign(
        {
          symbol,
          shortName: symbol + ' Inc.',
          regularMarketPrice: 50,
          regularMarketChangePercent: 1.5,
          marketCap,
          floatShares: 2e7,
          shortPercentOfFloat: 0.08,
        },
        extra || {}
      )
    );
  });
  return map;
}

test('scanFundamentals has no market-cap floor — a small-cap ticker the customer chose is still looked up', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor([['TINY', 5e7]])); // $50M — would have failed the old universe-scan floor
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({ peRatio: 20, debtToEquity: 0.5, revenueGrowth5Y: 12.3 }));
  t.mock.method(yahoo, 'quoteSummary', async () => ({ calendarEvents: { earnings: { earningsDate: [] } } }));

  const { results } = await scanFundamentals(['TINY']);
  assert.deepStrictEqual(
    results.map((r) => r.symbol),
    ['TINY']
  );
});

test('scanFundamentals carries float, short interest, and Finnhub fundamentals through', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor([['AAPL', 3e12]]));
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({ peRatio: 31.2, debtToEquity: 1.45, revenueGrowth5Y: 8.9 }));
  t.mock.method(yahoo, 'quoteSummary', async () => ({
    calendarEvents: { earnings: { earningsDate: ['2026-11-05T00:00:00.000Z'] } },
  }));

  const { results } = await scanFundamentals(['AAPL']);
  assert.strictEqual(results.length, 1);
  const r = results[0];
  assert.strictEqual(r.floatShares, 2e7);
  assert.strictEqual(r.shortPercent, 0.08);
  assert.strictEqual(r.peRatio, 31.2);
  assert.strictEqual(r.debtToEquity, 1.45);
  assert.strictEqual(r.revenueGrowth5Y, 8.9);
  assert.strictEqual(r.nextEarningsDate, '2026-11-05');
});

test('scanFundamentals never fabricates a value Finnhub/Yahoo did not report', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor([['THIN', 5e9]]));
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({})); // no fields reported at all
  t.mock.method(yahoo, 'quoteSummary', async () => ({ calendarEvents: {} })); // no earnings date on file

  const { results } = await scanFundamentals(['THIN']);
  assert.strictEqual(results.length, 1);
  const r = results[0];
  assert.strictEqual(r.peRatio, 0);
  assert.strictEqual(r.debtToEquity, 0);
  assert.strictEqual(r.revenueGrowth5Y, null, 'null, not 0 — 0% growth and "unknown" must stay distinguishable');
  assert.strictEqual(r.nextEarningsDate, null);
});

test('scanFundamentals skips a ticker Yahoo has no quote for at all, without crashing the scan', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor([['KNOWN', 5e9]])); // GHOST omitted
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({ peRatio: 10, debtToEquity: 0.2, revenueGrowth5Y: 5 }));
  t.mock.method(yahoo, 'quoteSummary', async () => ({ calendarEvents: { earnings: { earningsDate: [] } } }));

  const { results, errors } = await scanFundamentals(['KNOWN', 'GHOST']);
  assert.deepStrictEqual(
    results.map((r) => r.symbol),
    ['KNOWN']
  );
  assert.ok(errors.includes('GHOST'));
});
