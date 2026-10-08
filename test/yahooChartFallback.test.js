require('./helpers/testEnv');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  latestMarketCap,
  parseChartQuote,
  fetchYahooChartQuote,
  fetchYahooChartQuotes,
} = require('../server/services/yahooChartFallback');
const { previousTradingDateKey } = require('../server/services/marketCalendar');

beforeEach((t) => t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T19:00:00.000Z') }));

test('Yahoo direct recovery bounds unique symbols and concurrency even if the caller requests more', async (t) => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  t.mock.method(global, 'fetch', async (url) => {
    calls += 1;
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    const symbol = decodeURIComponent(new URL(url).pathname.split('/').pop());
    const body = chartFixture();
    body.chart.result[0].meta.symbol = symbol;
    return {
      ok: true,
      json: async () =>
        url.includes('/v8/')
          ? body
          : {
              timeseries: {
                result: [
                  {
                    meta: { symbol: [symbol] },
                    timestamp: [Date.now() / 1000],
                    trailingMarketCap: [{ reportedValue: { raw: 1000 } }],
                  },
                ],
              },
            },
    };
  });
  const symbols = ['AAPL', 'AAPL', ...Array.from({ length: 40 }, (_, index) => `TEST${index}`)];
  const rows = await fetchYahooChartQuotes(symbols, { concurrency: 1000 });
  assert.equal(rows.length, 6);
  assert.equal(calls, 12);
  assert.ok(peak <= 2);
  assert.equal(new Set(rows.map((row) => row.symbol)).size, rows.length);
});

test('Yahoo recovery cancellation stops alternate-host and metric admission', async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(global, 'fetch', (_url, options) => {
    calls += 1;
    return new Promise((_resolve, reject) =>
      options.signal.addEventListener('abort', () => reject(new Error('synthetic cancellation')), { once: true })
    );
  });
  const request = fetchYahooChartQuote('AAPL', { signal: controller.signal });
  controller.abort();
  assert.equal(await request, null);
  assert.equal(calls, 1);
  assert.deepEqual(await fetchYahooChartQuotes(['AAPL'], { signal: controller.signal }), []);
  assert.equal(calls, 1);
});

function chartFixture() {
  const dates = ['2026-10-08'];
  while (dates.length < 12) dates.unshift(previousTradingDateKey(dates[0]));
  return {
    chart: {
      result: [
        {
          meta: {
            symbol: 'AAPL',
            currency: 'USD',
            regularMarketPrice: 100,
            regularMarketTime: Date.now() / 1000,
            regularMarketVolume: 2500,
            chartPreviousClose: 99,
          },
          timestamp: dates.map((date) => Date.parse(`${date}T13:30:00Z`) / 1000),
          indicators: { quote: [{ volume: dates.map((_, index) => 1000 + index * 100), close: dates.map(() => 99) }] },
        },
      ],
    },
  };
}

for (const [label, mutate] of [
  [
    'wrong currency',
    (row) => {
      row.meta.currency = 'EUR';
    },
  ],
  [
    'missing currency',
    (row) => {
      delete row.meta.currency;
    },
  ],
  [
    'duplicate daily sessions',
    (row) => {
      row.timestamp[5] = row.timestamp[4];
    },
  ],
  [
    'missing prior session',
    (row) => {
      row.timestamp.splice(10, 1);
      row.indicators.quote[0].volume.splice(10, 1);
    },
  ],
  [
    'future history',
    (row) => {
      row.timestamp[11] += 86400;
    },
  ],
  [
    'future quote timestamp',
    (row) => {
      row.meta.regularMarketTime += 3600;
    },
  ],
  [
    'overflowing average',
    (row) => {
      row.indicators.quote[0].volume.fill(Number.MAX_VALUE);
    },
  ],
]) {
  test(`Yahoo chart recovery rejects ${label}`, () => {
    const fixture = chartFixture();
    mutate(fixture.chart.result[0]);
    assert.equal(parseChartQuote(fixture, 'AAPL'), null);
  });
}

test('Yahoo chart recovery calculates daily change from the previous session, not the query-period start', () => {
  const fixture = chartFixture();
  fixture.chart.result[0].meta.chartPreviousClose = 1;
  const result = parseChartQuote(fixture, 'AAPL');
  assert.equal(result.regularMarketPreviousClose, 99);
  assert.equal(result.regularMarketChangePercent, ((100 - 99) / 99) * 100);
});

test('Yahoo market cap recovery refuses a missing provider timestamp', () => {
  assert.equal(
    latestMarketCap(
      { timeseries: { result: [{ meta: { symbol: ['AAPL'] }, trailingMarketCap: [{ reportedValue: { raw: 20 } }] }] } },
      'AAPL'
    ),
    null
  );
});

test('Yahoo market cap recovery refuses a different instrument', () => {
  assert.equal(
    latestMarketCap(
      {
        timeseries: {
          result: [
            {
              meta: { symbol: ['OTHER'] },
              timestamp: [Date.now() / 1000],
              trailingMarketCap: [{ reportedValue: { raw: 20 } }],
            },
          ],
        },
      },
      'AAPL'
    ),
    null
  );
});

test('Yahoo market cap recovery chooses the newest observation even when the array is unordered', () => {
  const result = latestMarketCap(
    {
      timeseries: {
        result: [
          {
            meta: { symbol: ['AAPL'] },
            timestamp: [2000, 1000],
            trailingMarketCap: [{ reportedValue: { raw: 20 } }, { reportedValue: { raw: 10 } }],
          },
        ],
      },
    },
    'AAPL'
  );
  assert.equal(result.value, 20);
});

test('Yahoo chart fallback rejects mismatched or absent provider symbol and malformed price', () => {
  const body = chartFixture();
  body.chart.result[0].meta.symbol = 'OTHER';
  assert.equal(parseChartQuote(body, 'AAPL'), null);
  delete body.chart.result[0].meta.symbol;
  assert.equal(parseChartQuote(body, 'AAPL'), null);
  body.chart.result[0].meta.symbol = 'BRK-B';
  assert.equal(parseChartQuote(body, 'BRK.B').symbol, 'BRK.B');
  body.chart.result[0].meta.regularMarketPrice = true;
  assert.equal(parseChartQuote(body, 'BRK.B'), null);
});

test('Yahoo chart fallback preserves provider timestamp and computes a completed-volume baseline', () => {
  const body = chartFixture();

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
