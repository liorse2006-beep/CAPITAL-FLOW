require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { latestMarketCap, parseChartQuote } = require('../server/services/yahooChartFallback');

test('Yahoo chart fallback preserves provider timestamp and computes a completed-volume baseline', () => {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    chart: {
      result: [
        {
          meta: {
            symbol: 'AAPL',
            shortName: 'Apple Inc.',
            regularMarketPrice: 100,
            regularMarketTime: now,
            regularMarketVolume: 2500,
            chartPreviousClose: 99,
            exchangeName: 'NMS',
          },
          timestamp: Array.from({ length: 12 }, (_, index) => now - (12 - index) * 86400),
          indicators: {
            quote: [
              {
                volume: Array.from({ length: 12 }, (_, index) => 1000 + index * 100),
                close: Array.from({ length: 12 }, () => 100),
              },
            ],
          },
        },
      ],
    },
  };

  const row = parseChartQuote(body, 'AAPL');
  assert.equal(row.symbol, 'AAPL');
  assert.equal(row.regularMarketPrice, 100);
  assert.equal(row.regularMarketVolume, 2500);
  assert.equal(row.averageDailyVolume10Day, 1550);
  assert.equal(row.quoteProvider, 'Yahoo Finance Chart API');
  assert.equal(row.regularMarketChangePercent, ((100 - 99) / 99) * 100);
});

test('Yahoo chart fallback rejects missing current price or incomplete history', () => {
  const row = parseChartQuote(
    {
      chart: {
        result: [
          {
            meta: { symbol: 'BAD', regularMarketTime: Math.floor(Date.now() / 1000) },
            timestamp: [1],
            indicators: { quote: [{ volume: [1000], close: [100] }] },
          },
        ],
      },
    },
    'BAD'
  );
  assert.equal(row, null);
});

test('Yahoo fundamentals-timeseries parser uses the newest positive provider value', () => {
  const result = latestMarketCap({
    timeseries: {
      result: [
        {
          timestamp: [1000, 2000],
          trailingMarketCap: [{ reportedValue: { raw: 10 } }, { reportedValue: { raw: 20 } }],
        },
      ],
    },
  });
  assert.equal(result.value, 20);
  assert.equal(result.asOf, new Date(2000 * 1000).toISOString());
});
