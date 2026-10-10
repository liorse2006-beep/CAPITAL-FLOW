require('./helpers/testEnv');
process.env.YAHOO_CHART_FALLBACK_ENABLED = 'true';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const quoteCache = require('../server/services/quoteCache');
const yahoo = require('../server/services/yahoo');
const fmp = require('../server/services/fmp');
const chart = require('../server/services/yahooChartFallback');

function providerRow(symbol, currency) {
  return {
    symbol,
    currency,
    regularMarketPrice: 100,
    regularMarketVolume: 5000,
    regularMarketTime: Math.floor(Date.now() / 1000),
    averageDailyVolume10Day: null,
    marketCap: 5_000_000_000,
    quoteProvider: 'FMP',
  };
}

test('an undenominated FMP row cannot suppress verified bounded Chart recovery', async (t) => {
  const symbol = 'CURRENCY_RECOVERY';
  t.mock.method(fmp, 'isConfigured', () => true);
  t.mock.method(fmp, 'fetchFmpQuotes', async () => [providerRow(symbol, null)]);
  t.mock.method(yahoo, 'quote', async () => {
    throw new Error('synthetic quote endpoint outage');
  });
  let chartCalls = 0;
  t.mock.method(chart, 'fetchYahooChartQuotes', async (symbols, options) => {
    chartCalls += 1;
    assert.deepEqual(symbols, [symbol]);
    assert.equal(options.concurrency, 2);
    return [{ ...providerRow(symbol, 'USD'), averageDailyVolume10Day: 2500, quoteProvider: 'Yahoo Finance Chart API' }];
  });

  const result = await quoteCache.getQuotes([symbol]);
  assert.equal(chartCalls, 1);
  assert.equal(result.size, 1);
  assert.equal(result.get(symbol).currency, 'USD');
  assert.equal(result.get(symbol).averageDailyVolume10Day, 2500);
  assert.equal(result.get(symbol).quoteProvider, 'Yahoo Finance Chart API');
  assert.equal(result.providerFailure, false);
  assert.equal(result.fallbackProvider, 'Yahoo Finance Chart API');
});

test('missing or conflicting FMP currency remains unavailable if no verified fallback exists', async (t) => {
  const symbols = ['CURRENCY_NULL', 'CURRENCY_MISSING', 'CURRENCY_OTHER'];
  t.mock.method(fmp, 'isConfigured', () => true);
  t.mock.method(fmp, 'fetchFmpQuotes', async () =>
    symbols.map((symbol, index) => providerRow(symbol, [null, undefined, 'EUR'][index]))
  );
  t.mock.method(yahoo, 'quote', async () => {
    throw new Error('synthetic quote endpoint outage');
  });
  t.mock.method(chart, 'fetchYahooChartQuotes', async () => []);

  const result = await quoteCache.getQuotes(symbols);
  assert.equal(result.size, 0);
  assert.equal(result.providerFailure, true);
  assert.equal(result.dataAsOf, null);
  assert.equal(result.fallbackProvider, null);
});

test('verified USD FMP rows still use the primary fast path without a fallback request', async (t) => {
  const symbol = 'CURRENCY_VERIFIED_PRIMARY';
  t.mock.method(fmp, 'isConfigured', () => true);
  t.mock.method(fmp, 'fetchFmpQuotes', async () => [providerRow(symbol, 'USD')]);
  let yahooCalls = 0;
  let chartCalls = 0;
  t.mock.method(yahoo, 'quote', async () => {
    yahooCalls += 1;
    return [];
  });
  t.mock.method(chart, 'fetchYahooChartQuotes', async () => {
    chartCalls += 1;
    return [];
  });

  const result = await quoteCache.getQuotes([symbol]);
  assert.equal(result.get(symbol).currency, 'USD');
  assert.equal(result.get(symbol).averageDailyVolume10Day, null);
  assert.equal(result.fallbackProvider, 'FMP');
  assert.equal(yahooCalls, 0);
  assert.equal(chartCalls, 0);
});
