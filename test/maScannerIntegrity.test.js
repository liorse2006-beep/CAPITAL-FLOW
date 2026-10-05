require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const yahoo = require('../server/services/yahoo');
const quoteCache = require('../server/services/quoteCache');
const { latestCompletedSessionDate } = require('../server/services/marketCalendar');
const { scanMA } = require('../server/services/maScanner');

function quoteFor(symbol) {
  return {
    symbol,
    currency: 'USD',
    regularMarketPrice: 101,
    regularMarketTime: new Date(Date.now()),
    marketCap: 2e9,
    regularMarketVolume: 4e6,
    averageDailyVolume10Day: 1e6,
  };
}

function historyFor(symbol, interval = '1d') {
  const latest = Date.parse(latestCompletedSessionDate(new Date(Date.now())) + 'T14:30:00.000Z');
  const step = interval === '1wk' ? 7 * 86400000 : 86400000;
  return {
    meta: { symbol, currency: 'USD' },
    quotes: Array.from({ length: 40 }, (_, index) => ({
      date: new Date(latest - (39 - index) * step),
      close: 101,
    })),
  };
}

function stub(t, symbol, chart, quote = quoteFor(symbol)) {
  t.mock.method(quoteCache, 'getQuotes', async () => {
    const result = new Map([[symbol, quote]]);
    result.dataAsOf = quote.regularMarketTime?.toISOString?.() || null;
    return result;
  });
  return t.mock.method(yahoo, 'chart', async () => chart);
}

function assertUnavailable(result, symbol) {
  assert.deepEqual(result.results, [], 'unverified history must not produce a market signal');
  assert.equal(result.dataStatus, 'unavailable', 'a provider integrity failure is not a successful empty scan');
  assert.deepEqual(result.errors, [symbol]);
  assert.deepEqual(result.checkedSymbols, [], 'a history failure must not re-arm a Radar as a verified no-match');
}

const corruptions = [
  ['wrong symbol', (chart) => ({ ...chart, meta: { ...chart.meta, symbol: 'OTHER' } })],
  ['wrong currency', (chart) => ({ ...chart, meta: { ...chart.meta, currency: 'EUR' } })],
  ['missing currency', (chart) => ({ ...chart, meta: { symbol: chart.meta.symbol } })],
  ['missing dates', (chart) => ({ ...chart, quotes: chart.quotes.map(({ close }) => ({ close })) })],
  [
    'old history',
    (chart) => ({
      ...chart,
      quotes: chart.quotes.map((bar) => ({ ...bar, date: new Date(bar.date.getTime() - 400 * 86400000) })),
    }),
  ],
  [
    'future history',
    (chart) => ({
      ...chart,
      quotes: chart.quotes.map((bar) => ({ ...bar, date: new Date(bar.date.getTime() + 100 * 86400000) })),
    }),
  ],
  [
    'duplicate dates',
    (chart) => ({ ...chart, quotes: chart.quotes.map((bar) => ({ ...bar, date: chart.quotes[0].date })) }),
  ],
  ['boolean closes', (chart) => ({ ...chart, quotes: chart.quotes.map((bar) => ({ ...bar, close: true })) })],
  ['array closes', (chart) => ({ ...chart, quotes: chart.quotes.map((bar) => ({ ...bar, close: [101] })) })],
  [
    'one missing close',
    (chart) => ({ ...chart, quotes: chart.quotes.map((bar, index) => (index === 30 ? { ...bar, close: null } : bar)) }),
  ],
  [
    'negative close',
    (chart) => ({ ...chart, quotes: chart.quotes.map((bar, index) => (index === 0 ? { ...bar, close: -101 } : bar)) }),
  ],
];

corruptions.forEach(([description, corrupt], index) => {
  test('MA rejects ' + description + ' before cache and signal creation', async (t) => {
    const symbol = 'HIST' + index;
    const chart = corrupt(historyFor(symbol));
    const quote = quoteFor(symbol);
    if (description === 'boolean closes') quote.regularMarketPrice = 1;
    stub(t, symbol, chart, quote);
    assertUnavailable(await scanMA([symbol], { ma: 20, distance: 2, interval: '1d' }), symbol);
  });
});

test('MA preserves valid daily and weekly history, numeric strings, and a known Yahoo share-class alias', async (t) => {
  for (const [symbol, interval, alias] of [
    ['GOODDAY', '1d'],
    ['GOODWEEK', '1wk'],
    ['BRK.B', '1d', 'BRK-B'],
  ]) {
    const chart = historyFor(alias || symbol, interval);
    chart.quotes = chart.quotes.map((bar) => ({ ...bar, close: '101' }));
    stub(t, symbol, chart);
    const result = await scanMA([symbol], { ma: 20, distance: 2, interval });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].maValue, 101);
    assert.equal(result.results[0].historyAsOf, chart.quotes.at(-1).date.toISOString());
    assert.equal(result.dataStatus, 'complete');
    assert.deepEqual(result.checkedSymbols, [symbol]);
    t.mock.reset();
  }
});

test('MA does not retain a malformed history response in cache', async (t) => {
  const symbol = 'RECOVER';
  const valid = historyFor(symbol);
  let calls = 0;
  stub(t, symbol, valid);
  t.mock.method(yahoo, 'chart', async () =>
    ++calls === 1 ? { ...valid, meta: { ...valid.meta, symbol: 'OTHER' } } : valid
  );
  assertUnavailable(await scanMA([symbol], { ma: 20, distance: 2, interval: '1d' }), symbol);
  const recovered = await scanMA([symbol], { ma: 20, distance: 2, interval: '1d' });
  assert.equal(recovered.results.length, 1);
  assert.equal(recovered.dataStatus, 'complete');
  assert.equal(calls, 2);
});

test('MA invalidates a same-day historical cache when a new exchange session closes', async (t) => {
  const symbol = 'CLOSEGATE';
  let now = Date.parse('2026-10-05T19:55:00.000Z');
  t.mock.method(Date, 'now', () => now);
  let chartCalls = 0;
  t.mock.method(quoteCache, 'getQuotes', async () => new Map([[symbol, quoteFor(symbol)]]));
  t.mock.method(yahoo, 'chart', async () => {
    chartCalls++;
    return historyFor(symbol);
  });
  assert.equal((await scanMA([symbol], { ma: 20, distance: 2, interval: '1d' })).results.length, 1);
  assert.equal((await scanMA([symbol], { ma: 20, distance: 2, interval: '1d' })).results.length, 1);
  assert.equal(chartCalls, 1, 'same completed-session history should remain cached');
  now = Date.parse('2026-10-05T20:05:00.000Z');
  const next = await scanMA([symbol], { ma: 20, distance: 2, interval: '1d' });
  assert.equal(next.results.length, 1);
  assert.equal(chartCalls, 2, 'cache TTL must not hide the newly completed session');
  assert.match(next.results[0].historyAsOf, /^2026-10-05/);
});

test('MA rejects a malformed required quote scalar even when history is valid', async (t) => {
  const symbol = 'BOOLQUOTE';
  stub(t, symbol, historyFor(symbol), { ...quoteFor(symbol), regularMarketPrice: true });
  assertUnavailable(await scanMA([symbol], { ma: 20, distance: 200, interval: '1d' }), symbol);
});

test('MA keeps a verified below-cap symbol as a real negative result without chart requests', async (t) => {
  const symbol = 'SMALLCAP';
  const chart = stub(t, symbol, historyFor(symbol), { ...quoteFor(symbol), marketCap: 100e6 });
  const result = await scanMA([symbol], { ma: 20, distance: 2, interval: '1d' });
  assert.deepEqual(result.results, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.checkedSymbols, [symbol]);
  assert.equal(result.dataStatus, 'complete');
  assert.equal(chart.mock.callCount(), 0);
});
