require('./helpers/testEnv');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const quoteCache = require('../server/services/quoteCache');
const finnhub = require('../server/services/finnhub');
const massive = require('../server/services/massive');
const {
  MARKET_DATA_PROBE_SYMBOLS,
  probeMarketData,
  hasLiveScanQuote,
  hasRequiredScanQuote,
  hasRequiredFinnhubQuote,
  hasRequiredFinnhubMetric,
  hasRequiredMassiveMetric,
  normalizeFullScan,
} = require('../server/services/marketDataHealth');

beforeEach((t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-09T18:01:00.000Z') });
});

function quote(symbol) {
  return {
    symbol,
    currency: 'USD',
    regularMarketTime: new Date('2026-09-09T18:00:00.000Z'),
    regularMarketPrice: 100,
    regularMarketVolume: 5_000_000,
    averageDailyVolume10Day: 2_000_000,
    marketCap: 5_000_000_000,
  };
}

function liveQuoteWithoutSlowFields(symbol) {
  return {
    symbol,
    currency: 'USD',
    regularMarketTime: new Date('2026-09-09T18:00:00.000Z'),
    regularMarketPrice: 100,
    regularMarketVolume: 5_000_000,
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

function finnhubQuote() {
  return { price: 100, dataAsOf: '2026-09-09T18:00:00.000Z', dataStatus: 'complete' };
}

function finnhubMetric() {
  return { marketCap: 5_000_000_000, avgVol10d: 2_000_000, dataStatus: 'complete' };
}

test('market-data probe reports complete only when both providers and full scan coverage are complete', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () =>
    quoteMap(MARKET_DATA_PROBE_SYMBOLS.map((symbol) => [symbol, quote(symbol)]))
  );
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => finnhubQuote());
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => finnhubMetric());

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

test('market-data probe stays usable when live quotes need verified slow-field fallback', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () =>
    quoteMap(
      MARKET_DATA_PROBE_SYMBOLS.map((symbol) => [symbol, liveQuoteWithoutSlowFields(symbol)]),
      { providerFailure: true }
    )
  );
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => null);
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => finnhubMetric());

  const result = await probeMarketData();

  assert.equal(result.ok, true);
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.liveQuoteSymbols, MARKET_DATA_PROBE_SYMBOLS.length);
  assert.equal(result.coverage.verifiedProbeSymbols, MARKET_DATA_PROBE_SYMBOLS.length);
  assert.equal(result.providers.yahoo.status, 'partial');
  assert.doesNotMatch(result.warning, /Yahoo quote coverage is unavailable/i);
});

test('market-data probe does not treat an incomplete Finnhub metric payload as coverage', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () =>
    quoteMap(MARKET_DATA_PROBE_SYMBOLS.map((symbol) => [symbol, quote(symbol)]))
  );
  t.mock.method(finnhub, 'fetchFinnhubQuote', async (symbol) =>
    symbol === MARKET_DATA_PROBE_SYMBOLS[0] ? finnhubQuote() : null
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
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => finnhubQuote());
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => finnhubMetric());
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

test('health quote checks reject booleans, infinity and coercion-only numeric strings', () => {
  for (const invalid of [true, Infinity, 'Infinity', '0x10', '']) {
    assert.equal(hasLiveScanQuote({ ...quote('AAPL'), regularMarketPrice: invalid }, 'AAPL'), false);
    assert.equal(hasRequiredScanQuote({ ...quote('AAPL'), marketCap: invalid }, 'AAPL'), false);
    assert.equal(hasRequiredFinnhubQuote({ ...finnhubQuote(), price: invalid }), false);
    assert.equal(hasRequiredFinnhubMetric({ ...finnhubMetric(), avgVol10d: invalid }), false);
  }
});

test('health quote coverage requires the exact dated instrument and currency', () => {
  assert.equal(hasLiveScanQuote(quote('MSFT'), 'AAPL'), false);
  assert.equal(hasLiveScanQuote({ ...quote('AAPL'), currency: 'EUR' }, 'AAPL'), false);
  assert.equal(hasLiveScanQuote({ ...quote('AAPL'), regularMarketTime: null }, 'AAPL'), false);
  assert.equal(hasLiveScanQuote({ ...quote('AAPL'), regularMarketTime: '2026-09-10T18:00:00Z' }, 'AAPL'), false);
  assert.equal(hasLiveScanQuote({ ...quote('AAPL'), regularMarketTime: '2026-09-08T18:00:00Z' }, 'AAPL'), false);
  assert.equal(hasLiveScanQuote({ ...quote('AAPL'), dataStatus: 'unavailable' }, 'AAPL'), false);
});

test('health probe cannot count stale cached quotes as verified even if fallback metrics work', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () =>
    quoteMap(
      MARKET_DATA_PROBE_SYMBOLS.map((symbol) => [
        symbol,
        { ...quote(symbol), regularMarketTime: '2026-09-08T18:00:00Z' },
      ])
    )
  );
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => finnhubQuote());
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => finnhubMetric());
  const result = await probeMarketData();
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.coverage.verifiedProbeSymbols, 0);
  assert.equal(result.dataAsOf, null);
});

test('health fallback metadata requires real non-future source dates', () => {
  for (const invalid of ['not-a-date', '2026-09-10T18:00:00.000Z', '']) {
    assert.equal(hasRequiredFinnhubQuote({ ...finnhubQuote(), dataAsOf: invalid }), false);
    assert.equal(
      hasRequiredMassiveMetric({
        marketCap: 10,
        avgVol10d: 10,
        dataAsOf: invalid,
        referenceAsOf: '2026-09-09T00:00:00.000Z',
      }),
      false
    );
  }
});

test('full-scan health rejects impossible, fractional and inconsistent coverage counts', () => {
  const valid = {
    dataStatus: 'complete',
    requestedSymbols: 6,
    verifiedSymbols: 6,
    missingSymbols: 0,
    dataAsOf: '2026-09-09T18:00:00.000Z',
    scanTime: '2026-09-09T18:00:30.000Z',
  };
  for (const changes of [
    { verifiedSymbols: 7 },
    { verifiedSymbols: -1 },
    { verifiedSymbols: 5.5 },
    { requestedSymbols: true },
    { requestedSymbols: 6.1 },
    { missingSymbols: 2 },
  ])
    assert.equal(normalizeFullScan({ ...valid, ...changes }), null);
  assert.equal(normalizeFullScan(valid).coveragePercent, 100);
});

test('an undated, future or inconsistent full scan cannot claim complete health', () => {
  const valid = {
    dataStatus: 'complete',
    requestedSymbols: 6,
    verifiedSymbols: 6,
    missingSymbols: 0,
    dataAsOf: '2026-09-09T18:00:00.000Z',
    scanTime: '2026-09-09T18:00:30.000Z',
  };
  for (const changes of [
    { dataAsOf: null },
    { scanTime: 'not-a-date' },
    { dataAsOf: '2026-09-10T18:00:00.000Z' },
    { verifiedSymbols: 5, missingSymbols: 1 },
  ])
    assert.notEqual(normalizeFullScan({ ...valid, ...changes })?.status, 'complete');
});
