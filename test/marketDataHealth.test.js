require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const quoteCache = require('../server/services/quoteCache');
const finnhub = require('../server/services/finnhub');
const massive = require('../server/services/massive');
const { MARKET_DATA_PROBE_SYMBOLS, probeMarketData } = require('../server/services/marketDataHealth');

function quote(symbol) {
  return {
    symbol,
    regularMarketPrice: 100,
    regularMarketVolume: 5_000_000,
    averageDailyVolume10Day: 2_000_000,
    marketCap: 5_000_000_000,
  };
}

function quoteMap(entries, metadata = {}) {
  const map = new Map(entries);
  Object.defineProperties(map, {
    dataAsOf: { value: metadata.dataAsOf || '2026-09-09T18:00:00.000Z' },
    providerFailure: { value: metadata.providerFailure === true },
    staleSymbols: { value: metadata.staleSymbols || [] },
  });
  return map;
}

test('market-data probe reports complete only when both providers and full scan coverage are complete', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () =>
    quoteMap(MARKET_DATA_PROBE_SYMBOLS.map((symbol) => [symbol, quote(symbol)]))
  );
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => ({ price: 100 }));
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({ marketCap: 5_000_000_000, avgVol10d: 2_000_000 }));

  const result = await probeMarketData({
    fullScan: {
      dataStatus: 'complete',
      requestedSymbols: 505,
      verifiedSymbols: 505,
      missingSymbols: 0,
      scanTime: '2026-09-09T18:00:00.000Z',
      dataAsOf: '2026-09-09T17:59:00.000Z',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'complete');
  assert.equal(result.coverage.verifiedProbeSymbols, MARKET_DATA_PROBE_SYMBOLS.length);
  assert.equal(result.providers.yahoo.status, 'complete');
  assert.equal(result.providers.finnhub.status, 'complete');
  assert.equal(result.providers.massive.status, 'not_configured');
  assert.equal(result.warning, null);
});

test('market-data probe exposes partial provider and full-universe coverage', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () =>
    quoteMap(MARKET_DATA_PROBE_SYMBOLS.slice(0, 4).map((symbol) => [symbol, quote(symbol)]))
  );
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => null);
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => null);

  const result = await probeMarketData({
    fullScan: {
      dataStatus: 'partial',
      requestedSymbols: 505,
      verifiedSymbols: 494,
      missingSymbols: 11,
      scanTime: '2026-09-09T18:00:00.000Z',
      dataAsOf: '2026-09-09T17:59:00.000Z',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.missingProbeSymbols, 2);
  assert.equal(result.providers.finnhub.status, 'unavailable');
  assert.match(result.warning, /verified 494\/505/i);
});

test('market-data probe does not treat an incomplete Finnhub metric payload as coverage', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () =>
    quoteMap(MARKET_DATA_PROBE_SYMBOLS.map((symbol) => [symbol, quote(symbol)]))
  );
  t.mock.method(finnhub, 'fetchFinnhubQuote', async (symbol) =>
    symbol === MARKET_DATA_PROBE_SYMBOLS[0] ? { price: 100 } : null
  );
  t.mock.method(finnhub, 'fetchFinnhubMetric', async (symbol) =>
    symbol === MARKET_DATA_PROBE_SYMBOLS[0] ? { marketCap: 5_000_000_000 } : { marketCap: null, avgVol10d: null }
  );

  const result = await probeMarketData({
    fullScan: {
      dataStatus: 'complete',
      requestedSymbols: 505,
      verifiedSymbols: 505,
      missingSymbols: 0,
    },
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.providers.finnhub.status, 'unavailable');
  assert.equal(result.providers.finnhub.coverage.verifiedQuoteSymbols, 1);
  assert.equal(result.providers.finnhub.coverage.verifiedMetricSymbols, 0);
  assert.equal(result.providers.finnhub.coverage.verifiedSymbols, 0);
  assert.match(result.warning, /required-field coverage is unavailable/i);
});

test('market-data probe fails closed when no required quote is available', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => quoteMap([]));
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => null);
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => null);

  const result = await probeMarketData();

  assert.equal(result.ok, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.sample, null);
  assert.equal(result.coverage.verifiedProbeSymbols, 0);
});

test('market-data probe records verified Massive slow-field coverage without treating it as live quotes', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () =>
    quoteMap(MARKET_DATA_PROBE_SYMBOLS.map((symbol) => [symbol, quote(symbol)]))
  );
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => ({ price: 100 }));
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({ marketCap: 5_000_000_000, avgVol10d: 2_000_000 }));
  t.mock.method(massive, 'isConfigured', () => true);
  t.mock.method(massive, 'fetchMassiveMetrics', async () => ({
    marketCap: 5_000_000_000,
    avgVol10d: 2_000_000,
    dataAsOf: '2026-09-09T00:00:00.000Z',
    referenceAsOf: '2026-09-09T00:00:00.000Z',
  }));

  const result = await probeMarketData({
    fullScan: { dataStatus: 'complete', requestedSymbols: 505, verifiedSymbols: 505, missingSymbols: 0 },
  });

  assert.equal(result.providers.massive.status, 'complete');
  assert.equal(result.providers.massive.capability, 'delayed daily metrics only');
  assert.equal(result.providers.massive.coverage.verifiedSymbols, MARKET_DATA_PROBE_SYMBOLS.length);
  assert.match(result.provider, /Massive/);
});
